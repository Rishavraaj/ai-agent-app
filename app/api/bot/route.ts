import { auth } from "@/lib/auth";
import { db } from "@/db";
import { meeting } from "@/db/schema";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import { runMomBot } from "@/lib/bot/mom-bot";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { url, title, durationMinutes } = await req.json();
  if (!url) return new Response("Meeting URL required", { status: 400 });

  const meetingId = nanoid();
  const meetingTitle = title || "Bot Meeting";

  await db.insert(meeting).values({
    id: meetingId,
    userId: session.user.id,
    title: meetingTitle,
    status: "pending",
    progress: "0",
    transcript: "",
  });

  // Launch bot in background — don't await
  runMomBot({
    meetingUrl: url,
    meetingId,
    userId: session.user.id,
    userEmail: session.user.email,
    userName: session.user.name,
    meetingTitle,
    durationMs: (durationMinutes ?? 60) * 60 * 1000,
  });

  return Response.json({ meetingId, status: "pending" }, { status: 202 });
}
