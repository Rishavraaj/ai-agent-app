"use client";
import { useEffect, useState } from "react";
import { useSession, signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Meeting = {
  id: string;
  title: string;
  status: "pending" | "processing" | "done" | "error";
  progress: number;
  createdAt: string;
};

const STATUS_COLORS = {
  pending: "text-zinc-400",
  processing: "text-yellow-400 animate-pulse",
  done: "text-green-400",
  error: "text-red-400",
};

export default function MeetingsPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<"file" | "youtube" | "bot">("file");
  const [ytUrl, setYtUrl] = useState("");
  const [ytTitle, setYtTitle] = useState("");
  const [botUrl, setBotUrl] = useState("");
  const [botTitle, setBotTitle] = useState("");
  const [botDuration, setBotDuration] = useState("60");

  useEffect(() => {
    if (!isPending && !session) router.push("/sign-in");
  }, [session, isPending, router]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/meetings").then((r) => r.json()).then(setMeetings);
  }, [session]);

  // Poll progress for processing meetings every 3s
  useEffect(() => {
    const processing = meetings.filter((m) => m.status === "processing");
    if (!processing.length) return;
    const interval = setInterval(async () => {
      const updates = await Promise.all(
        processing.map((m) =>
          fetch(`/api/meetings/progress?id=${m.id}`).then((r) => r.json())
        )
      );
      setMeetings((prev) =>
        prev.map((m) => {
          const idx = processing.findIndex((p) => p.id === m.id);
          if (idx === -1) return m;
          return { ...m, ...updates[idx] };
        })
      );
    }, 3000);
    return () => clearInterval(interval);
  }, [meetings]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", title || file.name);
    const res = await fetch("/api/meetings/transcribe", { method: "POST", body: fd });
    const data = await res.json();
    setMeetings((prev) => [
      { id: data.meetingId, title: title || file.name, status: "processing", createdAt: new Date().toISOString() },
      ...prev,
    ]);
    setTitle("");
    setFile(null);
    setUploading(false);
  }

  async function handleBot(e: React.FormEvent) {
    e.preventDefault();
    if (!botUrl.trim()) return;
    setUploading(true);
    const res = await fetch("/api/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: botUrl, title: botTitle || undefined, durationMinutes: Number(botDuration) }),
    });
    const data = await res.json();
    setMeetings((prev) => [
      { id: data.meetingId, title: botTitle || botUrl, status: "processing", progress: 0, createdAt: new Date().toISOString() },
      ...prev,
    ]);
    setBotUrl("");
    setBotTitle("");
    setUploading(false);
  }
    e.preventDefault();
    if (!ytUrl.trim()) return;
    setUploading(true);
    const res = await fetch("/api/meetings/youtube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: ytUrl, title: ytTitle || undefined }),
    });
    const data = await res.json();
    setMeetings((prev) => [
      { id: data.meetingId, title: ytTitle || ytUrl, status: "processing", createdAt: new Date().toISOString() },
      ...prev,
    ]);
    setYtUrl("");
    setYtTitle("");
    setUploading(false);
  }

  if (isPending || !session) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900">
        <h1 className="font-bold text-lg">🎙️ MeetingAI</h1>
        <div className="flex items-center gap-4">
          <Link href="/live" className="text-sm text-red-400 hover:text-red-300 transition font-medium">🔴 Live Meeting</Link>
          <Link href="/chat" className="text-sm text-zinc-400 hover:text-white transition">AI Chat</Link>
          <span className="text-sm text-zinc-400">{session.user.name}</span>
          <button onClick={() => signOut().then(() => router.push("/sign-in"))} className="text-sm text-zinc-500 hover:text-white transition">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 space-y-10">
        {/* Upload */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-zinc-800">
            {(["file", "youtube", "bot"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-6 py-3 text-sm font-medium transition ${tab === t ? "text-white border-b-2 border-indigo-500" : "text-zinc-500 hover:text-white"}`}
              >
                {t === "file" ? "📁 Upload File" : t === "youtube" ? "▶️ YouTube URL" : "🤖 Join Meeting"}
              </button>
            ))}
          </div>

          <div className="p-6">
            {tab === "file" ? (
              <form onSubmit={handleUpload} className="space-y-4">
                <input
                  type="text"
                  placeholder="Meeting title (optional)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
                />
                <div
                  className="border-2 border-dashed border-zinc-700 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 transition"
                  onClick={() => document.getElementById("file-input")?.click()}
                >
                  {file ? (
                    <p className="text-indigo-400">{file.name}</p>
                  ) : (
                    <p className="text-zinc-500">Click to select audio/video file<br /><span className="text-xs">mp3, mp4, wav, m4a, webm</span></p>
                  )}
                  <input id="file-input" type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </div>
                <button type="submit" disabled={!file || uploading} className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 font-medium transition">
                  {uploading ? "Uploading…" : "Upload & Transcribe"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleYouTube} className="space-y-4">
                <input
                  type="text"
                  placeholder="Meeting title (optional — auto-fetched from YouTube)"
                  value={ytTitle}
                  onChange={(e) => setYtTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
                />
                <input
                  type="url"
                  required
                  placeholder="https://youtube.com/watch?v=..."
                  value={ytUrl}
                  onChange={(e) => setYtUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
                />
                <button type="submit" disabled={!ytUrl.trim() || uploading} className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 font-medium transition">
                  {uploading ? "Processing…" : "Extract & Transcribe"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleBot} className="space-y-4">
                <p className="text-xs text-zinc-500">The bot will open the meeting in a browser, record audio, transcribe, and send you a summary when done.</p>
                <input
                  type="text"
                  placeholder="Meeting title (optional)"
                  value={botTitle}
                  onChange={(e) => setBotTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
                />
                <input
                  type="url"
                  required
                  placeholder="https://meet.google.com/xxx-xxxx-xxx"
                  value={botUrl}
                  onChange={(e) => setBotUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
                />
                <div className="flex items-center gap-3">
                  <label className="text-sm text-zinc-400 whitespace-nowrap">Max duration</label>
                  <select
                    value={botDuration}
                    onChange={(e) => setBotDuration(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:border-indigo-500 transition"
                  >
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="90">1.5 hours</option>
                    <option value="120">2 hours</option>
                  </select>
                </div>
                <button type="submit" disabled={!botUrl.trim() || uploading} className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 font-medium transition">
                  {uploading ? "Launching bot…" : "🤖 Send Bot to Meeting"}
                </button>
              </form>
            )}
          </div>
        </section>

        {/* Meetings list */}
        <section>
          <h2 className="font-semibold text-lg mb-4">Your Meetings</h2>
          {meetings.length === 0 ? (
            <p className="text-zinc-600">No meetings yet. Upload your first recording above.</p>
          ) : (
            <ul className="space-y-3">
              {meetings.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/meetings/${m.id}`}
                    className="block px-5 py-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-indigo-500 transition"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium">{m.title}</p>
                      <span className={`text-sm font-medium capitalize ${STATUS_COLORS[m.status]}`}>
                        {m.status === "processing" ? `${m.progress ?? 0}%` : m.status}
                      </span>
                    </div>
                    {m.status === "processing" && (
                      <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden mt-2">
                        <div
                          className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                          style={{ width: `${m.progress ?? 0}%` }}
                        />
                      </div>
                    )}
                    <p className="text-xs text-zinc-500 mt-1.5">
                      {new Date(m.createdAt).toLocaleString()}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
