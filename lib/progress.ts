import { db } from "@/db";
import { meeting } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function setProgress(meetingId: string, progress: number) {
  await db
    .update(meeting)
    .set({ progress: String(progress) })
    .where(eq(meeting.id, meetingId));
}
