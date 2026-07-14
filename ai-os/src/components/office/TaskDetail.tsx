"use client";

import { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { workers, orgUnit } from "@/server/office/registry";

interface Detail {
  task: {
    id: string;
    title: string;
    brief: string;
    department: string;
    status: string;
    result: string | null;
    error: string | null;
  };
  subtasks: { id: string; worker_key: string; title: string; status: string; output: string | null }[];
  events: { worker_key: string | null; message: string; created_at: string }[];
}

const RUNNING = new Set(["planning", "working", "synthesizing"]);

export default function TaskDetail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/office/tasks/${taskId}`);
    if (res.ok) setDetail(await res.json());
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!detail || !RUNNING.has(detail.task.status)) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [detail, load]);

  if (!detail) return null;
  const { task, subtasks } = detail;
  const dept = orgUnit(task.department);
  const accent = dept?.accent ?? "#818cf8";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded px-1.5 py-0.5 font-pixel text-[7px]" style={{ background: `${accent}22`, color: accent }}>
                {dept?.name.toUpperCase() ?? task.department}
              </span>
              <StatusChip status={task.status} />
            </div>
            <h2 className="mt-2 text-sm font-semibold">{task.title}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{task.brief}</p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] hover:text-white">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* subtasks */}
          <div className="space-y-2">
            {subtasks.map((s) => {
              const w = workers[s.worker_key];
              const open = openSub === s.id;
              return (
                <div key={s.id} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)]">
                  <button
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
                    onClick={() => setOpenSub(open ? null : s.id)}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.status === "done" ? "#4ade80" : s.status === "working" ? "#facc15" : s.status === "failed" ? "#f87171" : "#475077" }} />
                    <span className="text-xs font-medium">{w?.name ?? s.worker_key}</span>
                    <span className="flex-1 truncate text-xs text-[var(--muted)]">{s.title}</span>
                    <span className="text-[10px] text-[var(--muted)]">{s.status === "working" ? "typing…" : s.status}</span>
                  </button>
                  {open && s.output && (
                    <div className="deliverable border-t border-[var(--border)] px-4 py-3">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.output}</ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            })}
            {subtasks.length === 0 && (
              <p className="text-xs text-[var(--muted)]">Orchestrator is still planning the work…</p>
            )}
          </div>

          {/* final deliverable */}
          {task.result && (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-pixel text-[8px] tracking-wider" style={{ color: accent }}>
                  FINAL DELIVERABLE
                </h3>
                <button
                  onClick={() => {
                    const blob = new Blob([task.result!], { type: "text/markdown" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `${task.title.replace(/[^\w\d]+/g, "-").toLowerCase()}.md`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                  className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:text-white"
                  title="Download as Markdown for the Obsidian vault"
                >
                  ⬇ vault .md
                </button>
              </div>
              <div className="deliverable rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.result}</ReactMarkdown>
              </div>
            </div>
          )}

          {task.error && (
            <p className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {task.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    planning: ["#facc15", "planning"],
    working: ["#facc15", "team working"],
    synthesizing: ["#38bdf8", "lead reviewing"],
    done: ["#4ade80", "done"],
    failed: ["#f87171", "failed"],
  };
  const [color, label] = map[status] ?? ["#9aa3cc", status];
  return (
    <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ color, borderColor: `${color}55` }}>
      {label}
    </span>
  );
}
