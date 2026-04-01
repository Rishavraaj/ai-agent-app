"use client";
import { useEffect, useState } from "react";
import { useSession, signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Meeting = {
  id: string;
  title: string;
  status: "pending" | "processing" | "done" | "error";
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

  useEffect(() => {
    if (!isPending && !session) router.push("/sign-in");
  }, [session, isPending, router]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/meetings").then((r) => r.json()).then(setMeetings);
  }, [session]);

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

  if (isPending || !session) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900">
        <h1 className="font-bold text-lg">🎙️ MeetingAI</h1>
        <div className="flex items-center gap-4">
          <Link href="/chat" className="text-sm text-zinc-400 hover:text-white transition">AI Chat</Link>
          <span className="text-sm text-zinc-400">{session.user.name}</span>
          <button onClick={() => signOut().then(() => router.push("/sign-in"))} className="text-sm text-zinc-500 hover:text-white transition">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 space-y-10">
        {/* Upload */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h2 className="font-semibold text-lg mb-4">Upload Meeting Recording</h2>
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
              <input
                id="file-input"
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <button
              type="submit"
              disabled={!file || uploading}
              className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 font-medium transition"
            >
              {uploading ? "Uploading…" : "Upload & Transcribe"}
            </button>
          </form>
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
                    className="flex items-center justify-between px-5 py-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-indigo-500 transition"
                  >
                    <div>
                      <p className="font-medium">{m.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {new Date(m.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className={`text-sm font-medium capitalize ${STATUS_COLORS[m.status]}`}>
                      {m.status}
                    </span>
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
