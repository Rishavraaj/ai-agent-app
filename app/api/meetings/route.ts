import { auth } from "@/lib/auth";
import { db } from "@/db";
import { meeting, actionItem } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { headers } from "next/headers";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    const [m] = await db.select().from(meeting).where(eq(meeting.id, id));
    if (!m || m.userId !== session.user.id)
      return new Response("Not found", { status: 404 });

    const items = await db
      .select()
      .from(actionItem)
      .where(eq(actionItem.meetingId, id));

    return Response.json({ ...m, actionItems: items });
  }

  const meetings = await db
    .select()
    .from(meeting)
    .where(eq(meeting.userId, session.user.id))
    .orderBy(desc(meeting.createdAt));

  return Response.json(meetings);
}
