import type { Browser, Page } from "playwright";
import { mkdtemp, readdir, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import OpenAI from "openai";
import { db } from "@/db";
import { meeting } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setProgress } from "@/lib/progress";
import { extractMeetingInsights } from "@/lib/meeting-agent";
import { sendMeetingSummaryEmail } from "@/lib/email";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const USER_AGENT  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

// Selectors — exact match from meetingbot/meetingbot
const ENTER_NAME_FIELD = 'input[type="text"][aria-label="Your name"]';
const ASK_TO_JOIN_BTN  = '//button[.//span[text()="Ask to join"]]';
const JOIN_NOW_BTN     = '//button[.//span[text()="Join now"]]';
const LEAVE_BTN        = '//button[@aria-label="Leave call"]';
const PEOPLE_BTN       = '//button[@aria-label="People"]';
const INFO_POPUP_BTN   = '//button[.//span[text()="Got it"]]';
const MUTE_BTN         = '[aria-label*="Turn off microphone"]';
const CAMERA_OFF_BTN   = '[aria-label*="Turn off camera"]';

const WAITING_ROOM_TIMEOUT_MS = 5 * 60 * 1000; // 5 min to be admitted
const ALONE_LEAVE_MS          = 30_000;          // leave 30s after everyone goes

function detectPlatform(url: string): "meet" | "zoom" | "teams" | "unknown" {
  if (url.includes("meet.google.com")) return "meet";
  if (url.includes("zoom.us")) return "zoom";
  if (url.includes("teams.microsoft.com") || url.includes("teams.live.com")) return "teams";
  return "unknown";
}

async function joinGoogleMeet(page: Page, url: string, meetingId: string) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

  // Fill name field — required to enable the join button
  await page.waitForSelector(ENTER_NAME_FIELD, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.fill(ENTER_NAME_FIELD, "MOM Bot");

  // Mute mic/camera if still on
  try { await page.click(MUTE_BTN,       { timeout: 300 }); } catch {}
  try { await page.click(CAMERA_OFF_BTN, { timeout: 300 }); } catch {}

  // Click whichever join button appears first
  const entryBtn = await Promise.race([
    page.waitForSelector(JOIN_NOW_BTN,   { timeout: 60000 }).then(() => JOIN_NOW_BTN),
    page.waitForSelector(ASK_TO_JOIN_BTN, { timeout: 60000 }).then(() => ASK_TO_JOIN_BTN),
  ]);
  await page.click(entryBtn);

  // Status: waiting to be admitted
  await db.update(meeting).set({ status: "waiting" }).where(eq(meeting.id, meetingId));

  // Wait until we're actually in the call (leave button appears)
  try {
    await page.waitForSelector(LEAVE_BTN, { timeout: WAITING_ROOM_TIMEOUT_MS });
  } catch {
    // Never admitted — mark rejected
    await db.update(meeting).set({ status: "rejected" }).where(eq(meeting.id, meetingId));
    throw new Error("Bot was never admitted from waiting room");
  }

  // Dismiss post-join info popup if present
  try { await page.click(INFO_POPUP_BTN, { timeout: 5000 }); } catch {}
}

export async function runMomBot({
  meetingUrl,
  meetingId,
  userId,
  userEmail,
  userName,
  meetingTitle,
  durationMs = 60 * 60 * 1000,
}: {
  meetingUrl: string;
  meetingId: string;
  userId: string;
  userEmail: string;
  userName: string;
  meetingTitle: string;
  durationMs?: number;
}) {
  const platform = detectPlatform(meetingUrl);
  const tmpDir = await mkdtemp(join(tmpdir(), "mombot-"));
  let browser: Browser | null = null;

  try {
    await setProgress(meetingId, 5);

    // Lazy require — avoids Next.js bundler breaking CJS packages
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { chromium } = require("playwright-extra");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stealth = require("puppeteer-extra-plugin-stealth")();
    stealth.enabledEvasions.delete("iframe.contentWindow");
    stealth.enabledEvasions.delete("media.codecs");
    chromium.use(stealth);

    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: false,
      args: [
        "--incognito",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-infobars",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });

    const context = await browser.newContext({
      permissions: ["microphone", "camera"],
      userAgent: USER_AGENT,
    });

    // Anti-detection (mirrors meetingbot/meetingbot)
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver",           { get: () => undefined });
      Object.defineProperty(navigator, "plugins",             { get: () => [{ name: "Chrome PDF Plugin" }, { name: "Chrome PDF Viewer" }] });
      Object.defineProperty(navigator, "languages",           { get: () => ["en-US", "en"] });
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 });
      Object.defineProperty(navigator, "deviceMemory",        { get: () => 8 });
      (window as any).__momBotChunks = [];
    });

    const page = await context.newPage();
    await setProgress(meetingId, 10);

    if (platform === "meet") {
      await joinGoogleMeet(page, meetingUrl, meetingId);
    }

    await setProgress(meetingId, 20);
    await db.update(meeting).set({ status: "processing" }).where(eq(meeting.id, meetingId));

    // ── Participant monitoring — exact port of meetingbot/meetingbot ───────
    type Participant = { id: string; name: string };
    const participants: Participant[] = [];
    let timeAloneStarted: number = Infinity;

    // Open people panel
    try {
      const hasPeopleIcon = await page.evaluate(() => {
        const icon = Array.from(document.querySelectorAll("i")).find(el => el.textContent?.trim() === "people");
        if (icon) { (icon.closest("button") as HTMLElement)?.click(); return true; }
        return false;
      });
      if (!hasPeopleIcon) await page.click(PEOPLE_BTN).catch(() => {});
      await page.waitForSelector('[aria-label="Participants"]', { state: "visible", timeout: 8000 });
    } catch { console.warn("Participants panel not found"); }

    // Expose callbacks — exact signature from meetingbot/meetingbot
    await page.exposeFunction("onParticipantJoin", (participant: Participant) => {
      participants.push(participant);
      timeAloneStarted = Infinity;
    });
    await page.exposeFunction("onParticipantLeave", (participant: Participant) => {
      const idx = participants.findIndex(p => p.id === participant.id);
      if (idx !== -1) participants.splice(idx, 1);
      timeAloneStarted = participants.length === 1 ? Date.now() : Infinity;
    });

    // Exact MutationObserver logic from meetingbot/meetingbot (including mergedAudio handling)
    await page.evaluate(() => {      const peopleList = document.querySelector('[aria-label="Participants"]');
      if (!peopleList) { console.error("Could not find participants list element"); return; }

      const initialParticipants = Array.from(peopleList.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE);
      (window as any).participantArray = [];
      (window as any).mergedAudioParticipantArray = [];

      (window as any).handleMergedAudio = () => {
        const mergedAudioNode = document.querySelector('[aria-label="Merged audio"]');
        if (!mergedAudioNode) return;
        const detectedParticipants: any[] = [];
        mergedAudioNode.parentNode!.childNodes.forEach((childNode: any) => {
          const participantId = childNode.getAttribute?.("data-participant-id");
          if (!participantId) return;
          detectedParticipants.push({ id: participantId, name: childNode.getAttribute("aria-label") });
        });

        if (detectedParticipants.length > (window as any).mergedAudioParticipantArray.length) {
          detectedParticipants
            .filter((p: any) => !(window as any).mergedAudioParticipantArray.find((x: any) => x.id === p.id))
            .forEach((p: any) => {
              (window as any).mergedAudioParticipantArray.push(p);
              (window as any).onParticipantJoin(p);
              (window as any).participantArray.push(p);
            });
        } else if (detectedParticipants.length < (window as any).mergedAudioParticipantArray.length) {
          (window as any).mergedAudioParticipantArray
            .filter((p: any) => !detectedParticipants.find((x: any) => x.id === p.id))
            .forEach((p: any) => {
              if (!document.querySelector(`[data-requested-participant-id="${p.id}"]`)) {
                (window as any).onParticipantLeave(p);
                (window as any).participantArray = (window as any).participantArray.filter((x: any) => x.id !== p.id);
              }
              (window as any).mergedAudioParticipantArray = (window as any).mergedAudioParticipantArray.filter((x: any) => x.id !== p.id);
            });
        }
      };

      // Seed initial participants
      initialParticipants.forEach((node: any) => {
        const participant = { id: node.getAttribute("data-participant-id"), name: node.getAttribute("aria-label") };
        if (!participant.id) { (window as any).handleMergedAudio(); return; }
        (window as any).onParticipantJoin(participant);
        (window as any).participantArray.push(participant);
      });

      // Watch for changes
      new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          mutation.removedNodes.forEach((node: any) => {
            const id = node.getAttribute?.("data-participant-id");
            if (id && (window as any).participantArray.find((p: any) => p.id === id)) {
              (window as any).onParticipantLeave({ id, name: node.getAttribute("aria-label") });
              (window as any).participantArray = (window as any).participantArray.filter((p: any) => p.id !== id);
            } else if (document.querySelector('[aria-label="Merged audio"]')) {
              (window as any).handleMergedAudio();
            }
          });
          mutation.addedNodes.forEach((node: any) => {
            const id = node.getAttribute?.("data-participant-id");
            if (id && !(window as any).participantArray.find((p: any) => p.id === id)) {
              const participant = { id, name: node.getAttribute("aria-label") };
              (window as any).onParticipantJoin(participant);
              (window as any).participantArray.push(participant);
            } else if (document.querySelector('[aria-label="Merged audio"]')) {
              (window as any).handleMergedAudio();
            }
          });
        });
      }).observe(peopleList, { childList: true, subtree: true });
    });

    // If no one else found after seeding, start alone timer immediately
    if (participants.length === 0) timeAloneStarted = Date.now();

    // ── Audio capture ───────────────────────────────────────────────────────
    await page.evaluate(() => {
      const ctx = new AudioContext();
      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(stream).connect(dest);
        const recorder = new MediaRecorder(dest.stream, { mimeType: "audio/webm" });
        recorder.ondataavailable = e => {
          if (e.data.size > 0) {
            const reader = new FileReader();
            reader.onload = () => (window as any).__momBotChunks.push(reader.result);
            reader.readAsDataURL(e.data);
          }
        };
        recorder.start(10000);
        (window as any).__momBotRecorder = recorder;
      });
    });

    // Transcribe audio chunks every 30s
    let fullTranscript = "";
    const chunkInterval = setInterval(async () => {
      try {
        const chunks: string[] = await page.evaluate(() => {
          const c = [...(window as any).__momBotChunks];
          (window as any).__momBotChunks = [];
          return c;
        });
        for (const dataUrl of chunks) {
          const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
          const file = new File([buffer], "chunk.webm", { type: "audio/webm" });
          const result = await openai.audio.transcriptions.create({ file, model: "whisper-1" });
          if (result.text.trim()) {
            fullTranscript += " " + result.text.trim();
            await db.update(meeting).set({ transcript: fullTranscript.trim() }).where(eq(meeting.id, meetingId));
          }
        }
      } catch { /* ignore — page may have navigated */ }
    }, 30000);

    // ── Main loop — exact port of meetingbot/meetingbot ────────────────────
    const deadline = Date.now() + durationMs;
    while (true) {
      // participants.length === 1 in meetingbot means only the bot itself remains
      // our participants array only has real people, so length === 0 means alone
      if (participants.length <= 1) {
        const msDiff = Date.now() - timeAloneStarted;
        console.log(`Only bot left. ${Math.round(msDiff / 1000)}s / ${ALONE_LEAVE_MS / 1000}s`);
        if (msDiff > ALONE_LEAVE_MS) { console.log("Everyone left — leaving."); break; }
      }

      // Kicked: "Return to home screen" button, hidden leave button, or removed text
      const kicked =
        (await page.locator('//button[.//span[text()="Return to home screen"]]').count().catch(() => 0)) > 0 ||
        (await page.locator(LEAVE_BTN).isHidden({ timeout: 500 }).catch(() => true)) ||
        (await page.locator('text="You\'ve been removed from the meeting"').isVisible({ timeout: 500 }).catch(() => false));
      if (kicked) { console.log("Kicked from meeting."); break; }

      // Duration exceeded
      if (Date.now() > deadline) { console.log("Duration limit reached."); break; }

      // Dismiss info popups
      try { await page.click(INFO_POPUP_BTN, { timeout: 500 }); } catch {}

      console.log("Waiting 5 seconds...");
      await new Promise(r => setTimeout(r, 5000));
    }

    // Leave gracefully
    await page.click(LEAVE_BTN).catch(() => {});
    clearInterval(chunkInterval);

    // Final audio flush
    const finalChunks: string[] = await page.evaluate(() => {
      (window as any).__momBotRecorder?.stop();
      return [...(window as any).__momBotChunks];
    }).catch(() => []);

    for (const dataUrl of finalChunks) {
      const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
      const file = new File([buffer], "chunk.webm", { type: "audio/webm" });
      const result = await openai.audio.transcriptions.create({ file, model: "whisper-1" });
      if (result.text.trim()) fullTranscript += " " + result.text.trim();
    }

    await setProgress(meetingId, 80);
    const { summary, actionItems } = await extractMeetingInsights(fullTranscript.trim(), meetingId);
    await setProgress(meetingId, 95);

    await db.update(meeting)
      .set({ transcript: fullTranscript.trim(), summary, status: "done", progress: "100" })
      .where(eq(meeting.id, meetingId));

    await sendMeetingSummaryEmail({ to: userEmail, name: userName, title: meetingTitle, summary, actionItems });

  } catch (err) {
    console.error("MOM bot error:", err);
    // Don't overwrite "rejected" status
    const current = await db.select({ status: meeting.status }).from(meeting).where(eq(meeting.id, meetingId));
    if (current[0]?.status !== "rejected") {
      await db.update(meeting).set({ status: "error" }).where(eq(meeting.id, meetingId));
    }
  } finally {
    await browser?.close();
    await readdir(tmpDir)
      .then(files => Promise.all(files.map(f => unlink(join(tmpDir, f)).catch(() => {}))))
      .catch(() => {});
  }
}
