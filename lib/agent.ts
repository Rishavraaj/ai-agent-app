import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";

const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.7,
  streaming: true,
});

const prompt = ChatPromptTemplate.fromMessages([
  new SystemMessage(
    "You are a helpful, knowledgeable AI assistant. Be concise, accurate, and friendly. " +
      "Format responses with markdown when helpful."
  ),
  new MessagesPlaceholder("history"),
  ["human", "{input}"],
]);

export const chain = prompt.pipe(model).pipe(new StringOutputParser());

export type ChatHistory = { role: "user" | "assistant"; content: string }[];

export function toMessages(history: ChatHistory) {
  return history.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)
  );
}
