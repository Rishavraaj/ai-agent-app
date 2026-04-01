import { auth } from "@/lib/auth";
import { db } from "@/db";
import { meeting } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import OpenAI from "openai";
import { nanoid } from "nanoid";
import { extractMeetingInsights } from "@/lib/meeting-agent";
import { sendMeetingSummaryEmail } from "@/lib/email";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /api/meetings/live?action=start|chunk|stop
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  // --- START: create meeting record ---
  if (action === "start") {
    const { title } = await req.json();
    const meetingId = nanoid();
    await db.insert(meeting).values({
      id: meetingId,
      userId: session.user.id,
      title: title || "Live Meeting",
      status: "processing",
      progress: "0",
      transcript: "",
    });
    return Response.json({ meetingId });
  }

  // --- CHUNK: transcribe audio blob and append to transcript ---
  if (action === "chunk") {
    const formData = await req.formData();
    const meetingId = formData.get("meetingId") as string;
    const blob = formData.get("audio") as File;
    if (!meetingId || !blob) return new Response("Bad Request", { status: 400 });

    const [current] = await db
      .select({ transcript: meeting.transcript, userId: meeting.userId })
      .from(meeting)
      .where(eq(meeting.id, meetingId));

    if (!current || current.userId !== session.user.id)
      return new Response("Not found", { status: 404 });

    try {
      const transcription = await openai.audio.transcriptions.create({
        file: new File([blob], "chunk.webm", { type: "audio/webm" }),
        model: "whisper-1",
      });

      const newText = transcription.text.trim();
      if (newText) {
        const updated = [current.transcript, newText].filter(Boolean).join(" ");
        await db.update(meeting).set({ transcript: updated }).where(eq(meeting.id, meetingId));
      }

      return Response.json({ text: newText });
    } catch {
      return Response.json({ text: "" });
    }
  }

  // --- STOP: run LangChain extraction and finalize ---
  if (action === "stop") {
    const { meetingId } = await req.json();
    const [m] = await db.select().from(meeting).where(eq(meeting.id, meetingId));
    if (!m || m.userId !== session.user.id) return new Response("Not found", { status: 404 });

    if (!m.transcript) {
      await db.update(meeting).set({ status: "done", progress: "100" }).where(eq(meeting.id, meetingId));
      return Response.json({ summary: "", actionItems: [] });
    }

    const { summary, actionItems } = await extractMeetingInsights(m.transcript, meetingId);
    await db
      .update(meeting)
      .set({ summary, status: "done", progress: "100" })
      .where(eq(meeting.id, meetingId));

    await sendMeetingSummaryEmail({
      to: session.user.email,
      name: session.user.name,
      title: m.title,
      summary,
      actionItems,
    });

    return Response.json({ summary, actionItems });
  }

  return new Response("Invalid action", { status: 400 });
}
