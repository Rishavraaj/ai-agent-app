import { auth } from "@/lib/auth";
import { db } from "@/db";
import { meeting } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const [m] = await db
    .select({ status: meeting.status, progress: meeting.progress })
    .from(meeting)
    .where(eq(meeting.id, id));

  if (!m) return new Response("Not found", { status: 404 });

  return Response.json({ status: m.status, progress: Number(m.progress) });
}
