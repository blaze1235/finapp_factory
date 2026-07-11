"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) router.push("/office");
    else setError("Wrong password");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-xs rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-8"
      >
        <div className="font-pixel text-center text-[11px] leading-5 text-[var(--accent)]">
          AI OS
        </div>
        <h1 className="mt-1 text-center text-sm text-[var(--muted)]">Virtual Office</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="mt-6 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          disabled={busy || !password}
          className="mt-4 w-full rounded-lg bg-[var(--accent)] py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "…" : "Enter the office"}
        </button>
      </form>
    </main>
  );
}
