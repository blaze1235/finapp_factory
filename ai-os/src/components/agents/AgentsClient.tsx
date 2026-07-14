"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { departments, deptWorkers, orgUnit, projects, workerProjects, workers } from "@/server/office/registry";

interface ActiveTask {
  id: string;
  department: string;
  status: string;
  subtasks: { worker: string; status: string }[];
}

export default function AgentsClient() {
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [gmail, setGmail] = useState<{ connected: boolean; configured: boolean } | null>(null);
  const params = useSearchParams();
  const gmailResult = params.get("gmail");

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/office/state");
        if (!res.ok) return;
        const d = await res.json();
        const w = new Set<string>();
        for (const t of (d.active ?? []) as ActiveTask[]) {
          for (const s of t.subtasks) if (s.status === "working") w.add(s.worker);
          if (t.status === "synthesizing") {
            const lead = orgUnit(t.department)?.lead;
            if (lead) w.add(lead);
          }
        }
        setWorking(w);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 4000);
    fetch("/api/gmail/status")
      .then((r) => r.json())
      .then(setGmail)
      .catch(() => {});
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-5 py-3.5">
        <div>
          <h1 className="text-sm font-semibold">🧑‍💻 AI Agents</h1>
          <p className="text-[11px] text-[var(--muted)]">
            {Object.values(departments).length} permanent departments · {Object.keys(workers).length} specialists ·{" "}
            {Object.values(projects).length} projects. An agent lives in ONE department and can work on many projects.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {gmailResult === "connected" && <span className="text-[11px] text-emerald-400">✅ Gmail connected</span>}
          {gmailResult === "error" && <span className="text-[11px] text-red-400">⚠️ Gmail connection failed</span>}
          {gmail?.connected ? (
            <span className="rounded-full border border-emerald-600/40 px-2.5 py-1 text-[10px] text-emerald-400">
              📧 Gmail connected
            </span>
          ) : (
            <a
              href="/api/gmail/connect"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-white"
              title={gmail && !gmail.configured ? "Needs GOOGLE_CLIENT_ID/SECRET set on the server first" : undefined}
            >
              📧 Connect Gmail
            </a>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="space-y-6">
          {Object.values(departments).map((dept) => {
            const team = deptWorkers(dept.key);
            return (
              <section key={dept.key}>
                <div className="mb-2.5 flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: dept.accent }} />
                  <h2 className="text-xs font-bold" style={{ color: dept.accent }}>
                    {dept.name}
                  </h2>
                  <span className="text-[10px] text-[var(--muted)]">{dept.description}</span>
                  <Link
                    href={`/chats?dept=${dept.key}`}
                    className="ml-auto rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-white"
                  >
                    💬 Chat
                  </Link>
                </div>
                <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                  {team.map((w) => {
                    const isLead = dept.lead === w.key;
                    const busy = working.has(w.key);
                    return (
                      <div key={w.key} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
                        <svg viewBox="0 0 12 16" width={30} height={40} shapeRendering="crispEdges" className={busy ? "anim-bob" : ""}>
                          <rect x={3} y={0} width={6} height={1} fill={w.hair} />
                          <rect x={2} y={1} width={8} height={2} fill={w.hair} />
                          <rect x={3} y={3} width={6} height={3} fill={w.skin} />
                          <rect x={4} y={4} width={1} height={1} fill="#181b26" />
                          <rect x={7} y={4} width={1} height={1} fill="#181b26" />
                          <rect x={2} y={6} width={8} height={5} fill={w.shirt} />
                          <rect x={3} y={11} width={6} height={3} fill="#232b3f" />
                          <rect x={3} y={14} width={6} height={1} fill="#11141f" />
                        </svg>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-xs font-semibold">
                            {w.name}
                            {isLead && (
                              <span className="rounded bg-[var(--panel-2)] px-1 py-px text-[8px] text-amber-300">LEAD</span>
                            )}
                          </p>
                          <p className="truncate text-[10px] text-[var(--muted)]">{w.role}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-[9px]">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${busy ? "led-blink bg-amber-400" : "bg-emerald-500"}`}
                            />
                            <span className="text-[var(--muted)]">{busy ? "working" : "available"}</span>
                          </p>
                          {workerProjects(w.key).length > 0 && (
                            <p className="mt-1 flex flex-wrap gap-1">
                              {workerProjects(w.key).map((p) => (
                                <span
                                  key={p.key}
                                  className="rounded-full px-1.5 py-px text-[8px]"
                                  style={{ background: `${p.accent}22`, color: p.accent }}
                                  title={`Working on ${p.name}${p.lead === w.key ? " (project lead)" : ""}`}
                                >
                                  {p.lead === w.key ? "★ " : ""}{p.name}
                                </span>
                              ))}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
