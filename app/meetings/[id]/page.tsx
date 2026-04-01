"use client";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import Link from "next/link";

type ActionItem = { id: string; task: string; assignee: string | null; dueDate: string | null; done: boolean };
type MeetingDetail = {
  id: string; title: string; status: string;
  transcript: string | null; summary: string | null;
  actionItems: ActionItem[]; createdAt: string;
};

export default function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [tab, setTab] = useState<"summary" | "transcript">("summary");
  const [id, setId] = useState<string>("");

  useEffect(() => { params.then((p) => setId(p.id)); }, [params]);
  useEffect(() => { if (!isPending && !session) router.push("/sign-in"); }, [session, isPending, router]);
  useEffect(() => {
    if (!session || !id) return;
    fetch(`/api/meetings?id=${id}`).then((r) => r.json()).then(setMeeting);
  }, [session, id]);

  if (isPending || !session || !meeting) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800 bg-zinc-900">
        <Link href="/meetings" className="text-zinc-400 hover:text-white transition">← Back</Link>
        <h1 className="font-bold text-lg">{meeting.title}</h1>
        <span className={`ml-auto text-sm capitalize ${meeting.status === "done" ? "text-green-400" : meeting.status === "processing" ? "text-yellow-400" : "text-red-400"}`}>
          {meeting.status}
        </span>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        {/* Action Items */}
        {meeting.actionItems.length > 0 && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <h2 className="font-semibold text-lg mb-4">✅ Action Items</h2>
            <ul className="space-y-3">
              {meeting.actionItems.map((item) => (
                <li key={item.id} className="flex items-start gap-3">
                  <span className="mt-0.5 text-indigo-400">◆</span>
                  <div>
                    <p className="font-medium">{item.task}</p>
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

        {/* Tabs: Summary / Transcript */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="flex border-b border-zinc-800">
            {(["summary", "transcript"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-6 py-3 text-sm font-medium capitalize transition ${tab === t ? "text-white border-b-2 border-indigo-500" : "text-zinc-500 hover:text-white"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="p-6 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
            {tab === "summary"
              ? meeting.summary ?? "Processing…"
              : meeting.transcript ?? "Transcript not available yet."}
          </div>
        </section>
      </main>
    </div>
  );
}
