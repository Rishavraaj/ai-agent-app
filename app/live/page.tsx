"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import Link from "next/link";

type ActionItem = { task: string; assignee?: string; dueDate?: string };
type Phase = "idle" | "recording" | "processing" | "done";

const CHUNK_INTERVAL_MS = 8000; // send chunk every 8s

export default function LiveMeetingPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [title, setTitle] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meetingIdRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!isPending && !session) router.push("/sign-in"); }, [session, isPending, router]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [transcript]);

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const res = await fetch("/api/meetings/live?action=start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || "Live Meeting" }),
    });
    const { meetingId: id } = await res.json();
    setMeetingId(id);
    meetingIdRef.current = id;
    setPhase("recording");
    setElapsed(0);

    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.start(CHUNK_INTERVAL_MS);

    // Send chunks every CHUNK_INTERVAL_MS
    intervalRef.current = setInterval(async () => {
      if (!chunksRef.current.length) return;
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      chunksRef.current = [];
      const fd = new FormData();
      fd.append("meetingId", meetingIdRef.current);
      fd.append("audio", blob, "chunk.webm");
      const r = await fetch("/api/meetings/live?action=chunk", { method: "POST", body: fd });
      const { text } = await r.json();
      if (text) setTranscript((prev) => prev ? prev + " " + text : text);
    }, CHUNK_INTERVAL_MS);

    // Elapsed timer
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }

  async function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    // Send any remaining chunks
    await new Promise((r) => setTimeout(r, 1200));
    if (chunksRef.current.length) {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      chunksRef.current = [];
      const fd = new FormData();
      fd.append("meetingId", meetingIdRef.current);
      fd.append("audio", blob, "chunk.webm");
      await fetch("/api/meetings/live?action=chunk", { method: "POST", body: fd });
    }

    setPhase("processing");
    const res = await fetch("/api/meetings/live?action=stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingId: meetingIdRef.current }),
    });
    const data = await res.json();
    setSummary(data.summary);
    setActionItems(data.actionItems ?? []);
    setPhase("done");
  }

  function formatTime(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  if (isPending || !session) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800 bg-zinc-900">
        <Link href="/meetings" className="text-zinc-400 hover:text-white transition">← Meetings</Link>
        <h1 className="font-bold text-lg">🔴 Live Meeting</h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10 space-y-8">

        {/* Setup / Controls */}
        {phase === "idle" && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">Start a Live Meeting</h2>
            <input
              type="text"
              placeholder="Meeting title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
            />
            <button
              onClick={startRecording}
              className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 font-semibold transition flex items-center justify-center gap-2"
            >
              <span className="w-3 h-3 rounded-full bg-white animate-pulse" />
              Start Recording
            </button>
          </section>
        )}

        {phase === "recording" && (
          <section className="bg-zinc-900 border border-red-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                <span className="font-semibold text-red-400">Recording</span>
              </div>
              <span className="font-mono text-zinc-400">{formatTime(elapsed)}</span>
            </div>
            <button
              onClick={stopRecording}
              className="w-full py-3 rounded-xl bg-zinc-700 hover:bg-zinc-600 font-semibold transition"
            >
              ⏹ Stop & Generate Summary
            </button>
          </section>
        )}

        {phase === "processing" && (
          <div className="text-center py-16 space-y-3">
            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-zinc-400">Generating summary and action items…</p>
          </div>
        )}

        {/* Live Transcript */}
        {(phase === "recording" || phase === "done") && transcript && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <h2 className="font-semibold mb-3 text-zinc-300">
              📝 Transcript {phase === "recording" && <span className="text-xs text-zinc-500 ml-2">updating live…</span>}
            </h2>
            <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">{transcript}</p>
            <div ref={bottomRef} />
          </section>
        )}

        {/* Results */}
        {phase === "done" && (
          <>
            {actionItems.length > 0 && (
              <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                <h2 className="font-semibold mb-4">✅ Action Items</h2>
                <ul className="space-y-3">
                  {actionItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="text-indigo-400 mt-0.5">◆</span>
                      <div>
                        <p className="font-medium text-sm">{item.task}</p>
                        <p className="text-xs text-zinc-500">
                          {item.assignee && `👤 ${item.assignee}`}
                          {item.assignee && item.dueDate && " · "}
                          {item.dueDate && `📅 ${item.dueDate}`}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {summary && (
              <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                <h2 className="font-semibold mb-3">📋 Summary</h2>
                <p className="text-sm text-zinc-300 leading-relaxed">{summary}</p>
              </section>
            )}

            <div className="flex gap-3">
              <Link
                href={`/meetings/${meetingId}`}
                className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-medium text-center transition"
              >
                View Full Meeting
              </Link>
              <button
                onClick={() => { setPhase("idle"); setTranscript(""); setSummary(""); setActionItems([]); setTitle(""); }}
                className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 font-medium transition"
              >
                New Meeting
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
