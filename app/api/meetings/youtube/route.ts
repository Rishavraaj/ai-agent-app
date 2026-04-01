import { auth } from "@/lib/auth";
import { db } from "@/db";
import { meeting } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import OpenAI from "openai";
import { extractMeetingInsights } from "@/lib/meeting-agent";
import { sendMeetingSummaryEmail } from "@/lib/email";

const execFileAsync = promisify(execFile);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { url, title } = await req.json();
  if (!url?.includes("youtube.com") && !url?.includes("youtu.be"))
    return new Response("Invalid YouTube URL", { status: 400 });

  const meetingId = nanoid();
  const meetingTitle = title || url;

  await db.insert(meeting).values({
    id: meetingId,
    userId: session.user.id,
    title: meetingTitle,
    status: "processing",
  });

  // Process in background
  (async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "meeting-"));
    const audioPath = join(tmpDir, "audio.mp3");

    try {
      // Download audio only with yt-dlp
      await execFileAsync("yt-dlp", [
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "5",
        "-o", audioPath,
        "--no-playlist",
        url,
      ]);

      // Get video title if none provided
      let resolvedTitle = meetingTitle;
      if (!title) {
        try {
          const { stdout } = await execFileAsync("yt-dlp", ["--get-title", "--no-playlist", url]);
          resolvedTitle = stdout.trim();
          await db.update(meeting).set({ title: resolvedTitle }).where(eq(meeting.id, meetingId));
        } catch { /* keep url as title */ }
      }

      // Transcribe with Whisper
      const audioBuffer = await readFile(audioPath);
      const audioFile = new File([audioBuffer], "audio.mp3", { type: "audio/mpeg" });

      const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
      });

      const { summary, actionItems } = await extractMeetingInsights(
        transcription.text,
        meetingId
      );

      await db
        .update(meeting)
        .set({ transcript: transcription.text, summary, status: "done" })
        .where(eq(meeting.id, meetingId));

      await sendMeetingSummaryEmail({
        to: session.user.email,
        name: session.user.name,
        title: resolvedTitle,
        summary,
        actionItems,
      });
    } catch (err) {
      console.error("YouTube processing error:", err);
      await db.update(meeting).set({ status: "error" }).where(eq(meeting.id, meetingId));
    } finally {
      await unlink(audioPath).catch(() => {});
    }
  })();

  return Response.json({ meetingId, status: "processing" }, { status: 202 });
}
