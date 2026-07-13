"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Memory {
  id: string;
  content: string;
  created_at: string;
}

interface Doc {
  id: string;
  filename: string;
  size_bytes: number;
  created_at: string;
}

export default function TeamMemoryPanel() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [open, setOpen] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [mRes, dRes] = await Promise.all([fetch("/api/memories"), fetch("/api/documents")]);
    if (mRes.ok) setMemories((await mRes.json()).memories ?? []);
    if (dRes.ok) setDocs((await dRes.json()).documents ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function removeMemory(id: string) {
    setMemories((m) => m.filter((x) => x.id !== id));
    await fetch(`/api/memories?id=${id}`, { method: "DELETE" });
  }

  async function removeDoc(id: string) {
    setDocs((d) => d.filter((x) => x.id !== id));
    await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setUploadError("");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/documents", { method: "POST", body: form });
    setUploading(false);
    if (res.ok) {
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setUploadError(d.error ?? "Upload failed");
    }
  }

  return (
    <aside className="hidden w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)] md:flex">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center justify-between px-4 py-3.5 text-left">
        <div>
          <h2 className="text-xs font-semibold">🧠 Team Memory</h2>
          <p className="text-[10px] text-[var(--muted)]">
            {memories.length} facts · {docs.length} files
          </p>
        </div>
        <span className="text-[var(--muted)]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--border)] px-3 py-3">
          <p className="mb-2 px-1 text-[10px] text-[var(--muted)]">
            Say <span className="rounded bg-[var(--panel-2)] px-1 font-mono">remember: …</span> in any chat for a quick
            fact — instant, free.
          </p>

          <input ref={fileRef} type="file" onChange={onFilePicked} className="hidden" accept=".txt,.md,.csv,.json,.log,.pdf" />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="mb-3 w-full rounded-lg border border-dashed border-[var(--border)] py-2 text-[11px] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-white disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "📎 Upload file (.txt .md .csv .pdf)"}
          </button>
          {uploadError && <p className="mb-2 text-[10px] text-red-400">{uploadError}</p>}

          {docs.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {docs.map((d) => (
                <div key={d.id} className="group flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2">
                  <span className="text-xs">📄</span>
                  <span className="min-w-0 flex-1 truncate text-[11px]">{d.filename}</span>
                  <button
                    onClick={() => removeDoc(d.id)}
                    className="shrink-0 text-[10px] text-[var(--muted)] opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {memories.length === 0 && docs.length === 0 && (
            <p className="px-1 text-[11px] text-[var(--muted)]">Nothing remembered yet.</p>
          )}
          <div className="space-y-1.5">
            {memories.map((m) => (
              <div key={m.id} className="group rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[11px] leading-snug">{m.content}</p>
                  <button
                    onClick={() => removeMemory(m.id)}
                    className="shrink-0 text-[10px] text-[var(--muted)] opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
                <p className="mt-1 text-[9px] text-[var(--muted)]">{new Date(m.created_at).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
