import { auth } from "@/lib/auth";
import { db } from "@/db";
import { chatMessage } from "@/db/schema";
import { chain, toMessages, type ChatHistory } from "@/lib/agent";
import { headers } from "next/headers";
import { eq, asc } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { message } = await req.json();
  if (!message?.trim()) return new Response("Bad Request", { status: 400 });

  // Load last 20 messages for context
  const history = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.userId, session.user.id))
    .orderBy(asc(chatMessage.createdAt))
    .limit(20);

  // Persist user message
  await db.insert(chatMessage).values({
    id: nanoid(),
    userId: session.user.id,
    role: "user",
    content: message,
  });

  // Stream AI response
  const stream = await chain.stream({
    input: message,
    history: toMessages(history as ChatHistory),
  });

  const encoder = new TextEncoder();
  let fullResponse = "";

  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        fullResponse += chunk;
        controller.enqueue(encoder.encode(chunk));
      }
      // Persist assistant message after stream completes
      await db.insert(chatMessage).values({
        id: nanoid(),
        userId: session.user.id,
        role: "assistant",
        content: fullResponse,
      });
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const messages = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.userId, session.user.id))
    .orderBy(asc(chatMessage.createdAt));

  return Response.json(messages);
}
