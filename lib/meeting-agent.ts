import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { db } from "@/db";
import { actionItem } from "@/db/schema";
import { nanoid } from "nanoid";

const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });

const prompt = PromptTemplate.fromTemplate(`
You are an expert meeting analyst. Given the transcript below, extract:

1. A concise summary (3-5 sentences)
2. All action items in JSON array format

Return ONLY valid JSON in this exact shape:
{{
  "summary": "...",
  "actionItems": [
    {{ "task": "...", "assignee": "...", "dueDate": "..." }}
  ]
}}

If no assignee or due date is mentioned, use null.

Transcript:
{transcript}
`);

const chain = prompt.pipe(model);

export async function extractMeetingInsights(transcript: string, meetingId: string) {
  const result = await chain.invoke({ transcript });
  const text = typeof result.content === "string" ? result.content : "";

  let parsed: { summary: string; actionItems: { task: string; assignee?: string; dueDate?: string }[] };
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { summary: "Could not extract summary.", actionItems: [] };
  }

  if (parsed.actionItems?.length) {
    await db.insert(actionItem).values(
      parsed.actionItems.map((item) => ({
        id: nanoid(),
        meetingId,
        task: item.task,
        assignee: item.assignee ?? null,
        dueDate: item.dueDate ?? null,
      }))
    );
  }

  return { summary: parsed.summary, actionItems: parsed.actionItems ?? [] };
}
