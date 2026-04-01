"use client";
import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

type Message = { id: string; role: "user" | "assistant"; content: string };

export default function ChatPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPending && !session) router.push("/sign-in");
  }, [session, isPending, router]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/chat")
      .then((r) => r.json())
      .then(setMessages);
  }, [session]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || streaming) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: input };
    const assistantMsg: Message = { id: crypto.randomUUID(), role: "assistant", content: "" };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: m.content + chunk } : m
        )
      );
    }
    setStreaming(false);
  }

  if (isPending || !session) return null;

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold">
            AI
          </div>
          <span className="font-semibold">AI Agent</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-400">{session.user.name}</span>
          <button
            onClick={() => signOut().then(() => router.push("/sign-in"))}
            className="text-sm text-zinc-500 hover:text-white transition"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-zinc-600 mt-20">
            <p className="text-4xl mb-3">✦</p>
            <p className="text-lg">How can I help you today?</p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-sm"
                  : "bg-zinc-800 text-zinc-100 rounded-bl-sm"
              }`}
            >
              {m.content}
              {m.role === "assistant" && streaming && m.content === "" && (
                <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={sendMessage}
        className="px-4 pb-6 pt-2 border-t border-zinc-800 bg-zinc-900"
      >
        <div className="flex gap-3 max-w-3xl mx-auto">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message AI Agent…"
            disabled={streaming}
            className="flex-1 px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 font-medium transition"
          >
            {streaming ? "…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
