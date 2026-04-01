import { auth } from "@/lib/auth";
import { db } from "@/db";
import { meeting } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import OpenAI from "openai";
import { nanoid } from "nanoid";
import { extractMeetingInsights } from "@/lib/meeting-agent";
import { sendMeetingSummaryEmail } from "@/lib/email";
import { setProgress } from "@/lib/progress";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File;
  const title = (formData.get("title") as string) || "Untitled Meeting";

  if (!file) return new Response("No file provided", { status: 400 });

  // Create meeting record
  const meetingId = nanoid();
  await db.insert(meeting).values({
    id: meetingId,
    userId: session.user.id,
    title,
    status: "processing",
  });

  // Transcribe with Whisper (non-blocking — process in background)
  (async () => {
    try {
      await setProgress(meetingId, 10);

      const transcription = await openai.audio.transcriptions.create({
        file,
        model: "whisper-1",
      });
      await setProgress(meetingId, 70);

      const { summary, actionItems } = await extractMeetingInsights(
        transcription.text,
        meetingId
      );
      await setProgress(meetingId, 90);

      await db
        .update(meeting)
        .set({ transcript: transcription.text, summary, status: "done", progress: "100" })
        .where(eq(meeting.id, meetingId));

      await sendMeetingSummaryEmail({
        to: session.user.email,
        name: session.user.name,
        title,
        summary,
        actionItems,
      });
    } catch {
      await db
        .update(meeting)
        .set({ status: "error" })
        .where(eq(meeting.id, meetingId));
    }
  })();

  return Response.json({ meetingId, status: "processing" }, { status: 202 });
}
