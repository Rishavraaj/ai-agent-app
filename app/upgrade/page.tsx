"use client";
import { useState } from "react";
import { useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export default function UpgradePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    if (!session) return router.push("/sign-in");
    setLoading(true);
    const res = await fetch("/api/stripe", { method: "POST" });
    const { url } = await res.json();
    window.location.href = url;
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white">
      <div className="max-w-sm w-full p-8 bg-zinc-900 border border-zinc-800 rounded-2xl text-center space-y-6">
        <div className="text-5xl">🎙️</div>
        <h1 className="text-2xl font-bold">MeetingAI Pro</h1>
        <p className="text-zinc-400 text-sm">Unlimited meeting transcriptions, AI summaries, action items, and email reports.</p>

        <div className="bg-zinc-800 rounded-xl p-4 space-y-2 text-sm text-left">
          {["Unlimited recordings", "AI-powered summaries", "Auto action item extraction", "Email reports after every meeting"].map((f) => (
            <div key={f} className="flex items-center gap-2">
              <span className="text-green-400">✓</span>
              <span>{f}</span>
            </div>
          ))}
        </div>

        <div>
          <p className="text-3xl font-bold">$19<span className="text-lg text-zinc-400">/mo</span></p>
          <p className="text-xs text-zinc-500 mt-1">Cancel anytime</p>
        </div>

        <button
          onClick={handleUpgrade}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold transition"
        >
          {loading ? "Redirecting…" : "Upgrade to Pro"}
        </button>
      </div>
    </main>
  );
}
