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

const CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

// Selectors (from meetingbot/meetingbot reference)
const ENTER_NAME_FIELD  = 'input[type="text"][aria-label="Your name"]';
const ASK_TO_JOIN_BTN   = '//button[.//span[text()="Ask to join"]]';
const JOIN_NOW_BTN      = '//button[.//span[text()="Join now"]]';
const LEAVE_BTN         = '//button[@aria-label="Leave call"]';
const INFO_POPUP_BTN    = '//button[.//span[text()="Got it"]]';

// Detect meeting platform from URL
function detectPlatform(url: string): "meet" | "zoom" | "teams" | "unknown" {
  if (url.includes("meet.google.com")) return "meet";
  if (url.includes("zoom.us")) return "zoom";
  if (url.includes("teams.microsoft.com") || url.includes("teams.live.com")) return "teams";
  return "unknown";
}

// Platform-specific join logic
async function joinMeeting(page: Page, url: string, platform: string) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

  if (platform === "meet") {
    // Wait for name field and fill it — this enables the join button
    await page.waitForSelector(ENTER_NAME_FIELD, { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.fill(ENTER_NAME_FIELD, "MOM Bot");

    // Turn off mic/camera if still on
    try { await page.click('[aria-label*="Turn off microphone"]', { timeout: 500 }); } catch {}
    try { await page.click('[aria-label*="Turn off camera"]',    { timeout: 500 }); } catch {}

    // Race between "Join now" (host) and "Ask to join" (guest)
    const entryBtn = await Promise.race([
      page.waitForSelector(JOIN_NOW_BTN,   { timeout: 60000 }).then(() => JOIN_NOW_BTN),
      page.waitForSelector(ASK_TO_JOIN_BTN, { timeout: 60000 }).then(() => ASK_TO_JOIN_BTN),
    ]);
    await page.click(entryBtn);

    // Confirm we're in the call
    await page.waitForSelector(LEAVE_BTN, { timeout: 60000 });

    // Dismiss any post-join popups
    try { await page.click(INFO_POPUP_BTN, { timeout: 5000 }); } catch {}
  }

  if (platform === "zoom") {
    // Handle Zoom web client
    await page.waitForTimeout(2000);
    const webBtn = page.locator('a:has-text("join from your browser"), a:has-text("Join from Browser")').first();
    if (await webBtn.isVisible({ timeout: 5000 }).catch(() => false)) await webBtn.click();
    await page.waitForTimeout(2000);
    const joinBtn = page.locator('button:has-text("Join"), button[id*="join"]').first();
    if (await joinBtn.isVisible({ timeout: 8000 }).catch(() => false)) await joinBtn.click();
  }

  if (platform === "teams") {
    await page.waitForTimeout(3000);
    const joinBtn = page.locator('button:has-text("Join now"), button:has-text("Join meeting")').first();
    if (await joinBtn.isVisible({ timeout: 10000 }).catch(() => false)) await joinBtn.click();
  }
}

export async function runMomBot({
  meetingUrl,
  meetingId,
  userId,
  userEmail,
  userName,
  meetingTitle,
  durationMs = 60 * 60 * 1000, // default 1 hour max
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
  const rawAudioPath = join(tmpDir, "recording.webm");
  const mp3Path = join(tmpDir, "recording.mp3");

  let browser: Browser | null = null;

  try {
    await setProgress(meetingId, 5);

    // Lazy-load playwright-extra + stealth (must be outside module scope to avoid Next.js bundling)
    const { chromium } = require("playwright-extra");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stealth = require("puppeteer-extra-plugin-stealth")();
    stealth.enabledEvasions.delete("iframe.contentWindow");
    stealth.enabledEvasions.delete("media.codecs");
    chromium.use(stealth);

    // Launch with stealth-compatible args (mirrors meetingbot/meetingbot)
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
        "--use-file-for-fake-video-capture=/dev/null",
        "--use-file-for-fake-audio-capture=/dev/null",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });

    const context = await browser.newContext({
      permissions: ["microphone", "camera"],
      userAgent: USER_AGENT,
    });

    // Anti-detection init script (mirrors meetingbot/meetingbot)
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver",          { get: () => undefined });
      Object.defineProperty(navigator, "plugins",            { get: () => [{ name: "Chrome PDF Plugin" }, { name: "Chrome PDF Viewer" }] });
      Object.defineProperty(navigator, "languages",          { get: () => ["en-US", "en"] });
      Object.defineProperty(navigator, "hardwareConcurrency",{ get: () => 4 });
      Object.defineProperty(navigator, "deviceMemory",       { get: () => 8 });
    });

    // Init audio chunk storage
    await context.addInitScript(() => {
      (window as any).__momBotChunks = [];
    });

    const page = await context.newPage();
    await setProgress(meetingId, 10);

    await joinMeeting(page, meetingUrl, platform);
    await setProgress(meetingId, 20);

    // Start audio capture via page evaluate — captures all tab audio
    await page.evaluate(() => {
      const ctx = new AudioContext();
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        const source = ctx.createMediaStreamSource(stream);
        const dest = ctx.createMediaStreamDestination();
        source.connect(dest);

        const recorder = new MediaRecorder(dest.stream, { mimeType: "audio/webm" });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            const reader = new FileReader();
            reader.onload = () => {
              (window as any).__momBotChunks.push(reader.result);
            };
            reader.readAsDataURL(e.data);
          }
        };
        recorder.start(10000); // chunk every 10s
        (window as any).__momBotRecorder = recorder;
        (window as any).__momBotRecording = true;
      });
    });

    await db.update(meeting).set({ status: "processing" }).where(eq(meeting.id, meetingId));

    // Poll for audio chunks and transcribe every 30s
    let fullTranscript = "";
    const chunkInterval = setInterval(async () => {
      try {
        const chunks: string[] = await page.evaluate(() => {
          const c = [...(window as any).__momBotChunks];
          (window as any).__momBotChunks = [];
          return c;
        });

        for (const dataUrl of chunks) {
          const base64 = dataUrl.split(",")[1];
          const buffer = Buffer.from(base64, "base64");
          const file = new File([buffer], "chunk.webm", { type: "audio/webm" });
          const result = await openai.audio.transcriptions.create({ file, model: "whisper-1" });
          if (result.text.trim()) {
            fullTranscript += " " + result.text.trim();
            await db.update(meeting).set({ transcript: fullTranscript.trim() }).where(eq(meeting.id, meetingId));
          }
        }
      } catch { /* page may have navigated */ }
    }, 30000);

    // Wait for meeting to end — leave button disappears when call ends, or hit duration timeout
    await Promise.race([
      page.waitForSelector('//button[@aria-label="Leave call"]', { state: "detached", timeout: durationMs }),
      new Promise((r) => setTimeout(r, durationMs)),
    ]);

    clearInterval(chunkInterval);

    // Final chunk flush
    const finalChunks: string[] = await page.evaluate(() => {
      (window as any).__momBotRecorder?.stop();
      return [...(window as any).__momBotChunks];
    }).catch(() => []);

    for (const dataUrl of finalChunks) {
      const base64 = dataUrl.split(",")[1];
      const buffer = Buffer.from(base64, "base64");
      const file = new File([buffer], "chunk.webm", { type: "audio/webm" });
      const result = await openai.audio.transcriptions.create({ file, model: "whisper-1" });
      if (result.text.trim()) fullTranscript += " " + result.text.trim();
    }

    await setProgress(meetingId, 80);

    // Extract insights
    const { summary, actionItems } = await extractMeetingInsights(fullTranscript.trim(), meetingId);
    await setProgress(meetingId, 95);

    await db.update(meeting)
      .set({ transcript: fullTranscript.trim(), summary, status: "done", progress: "100" })
      .where(eq(meeting.id, meetingId));

    await sendMeetingSummaryEmail({ to: userEmail, name: userName, title: meetingTitle, summary, actionItems });

  } catch (err) {
    console.error("MOM bot error:", err);
    await db.update(meeting).set({ status: "error" }).where(eq(meeting.id, meetingId));
  } finally {
    await browser?.close();
    // Cleanup tmp files
    await readdir(tmpDir).then((files) =>
      Promise.all(files.map((f) => unlink(join(tmpDir, f)).catch(() => {})))
    ).catch(() => {});
  }
}
