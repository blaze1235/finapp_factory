"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { allUnits, workers } from "@/server/office/registry";

interface Report {
  department: string;
  content: string;
  created_at: string;
}

export default function ReportsClient() {
  const [week, setWeek] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/reports");
    if (res.ok) {
      const d = await res.json();
      setWeek(d.week);
      setReports(d.reports ?? []);
      if (generating && (d.reports?.length ?? 0) >= allUnits().length) setGenerating(false);
    }
  }, [generating]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!generating) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [generating, load]);

  async function generateNow() {
    setGenerating(true);
    await fetch("/api/reports", { method: "POST" });
  }

  const byDept = Object.fromEntries(reports.map((r) => [r.department, r]));

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-5 py-3.5">
        <div>
          <h1 className="text-sm font-semibold">📊 Weekly Reports</h1>
          <p className="text-[11px] text-[var(--muted)]">
            Every team lead reports on real recorded activity — week of {week || "…"}.
          </p>
        </div>
        <button
          onClick={generateNow}
          disabled={generating}
          className="ml-auto rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
        >
          {generating ? "Leads writing…" : reports.length ? "🔄 Regenerate" : "📝 Generate reports"}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {reports.length === 0 && !generating ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="text-3xl">📊</span>
            <p className="text-sm text-[var(--muted)]">No reports for this week yet.</p>
            <p className="max-w-sm text-[11px] text-[var(--muted)]">
              Hit Generate — each lead writes a short report strictly from this week&apos;s recorded tasks and
              discussions. Teams with no activity say so honestly.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {allUnits().map((dept) => {
              const r = byDept[dept.key];
              const lead = workers[dept.lead];
              return (
                <section key={dept.key} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: dept.accent }}
                    >
                      {lead.name[0]}
                    </span>
                    <div>
                      <p className="text-xs font-semibold" style={{ color: dept.accent }}>
                        {dept.kind === "project" ? "🚀 " : ""}{dept.name}
                      </p>
                      <p className="text-[10px] text-[var(--muted)]">
                        {lead.name} · {lead.role}
                      </p>
                    </div>
                  </div>
                  {r ? (
                    <div className="deliverable">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                      {generating ? (
                        <>
                          <span className="typing-dots" /> writing…
                        </>
                      ) : (
                        "no report yet"
                      )}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
