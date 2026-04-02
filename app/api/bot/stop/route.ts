import { auth } from "@/lib/auth";
import { db } from "@/db";
import { meeting } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { requestStop } from "@/lib/bot/stop-signal";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { meetingId } = await req.json();
  if (!meetingId) return new Response("Missing meetingId", { status: 400 });

  // Verify ownership
  const [m] = await db
    .select({ userId: meeting.userId, status: meeting.status })
    .from(meeting)
    .where(eq(meeting.id, meetingId));

  if (!m || m.userId !== session.user.id) return new Response("Not found", { status: 404 });
  if (m.status !== "processing" && m.status !== "waiting")
    return new Response("Bot is not active", { status: 400 });

  requestStop(meetingId);
  return Response.json({ ok: true });
}
