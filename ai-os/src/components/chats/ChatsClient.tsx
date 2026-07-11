"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { departments, workers, type DeptKey } from "@/server/office/registry";

interface ChatRow {
  id: string;
  scope: "office" | "dept";
  department: string | null;
  title: string;
  busy: boolean;
  updated_at: string;
}

interface Msg {
  id: number;
  role: "user" | "agent";
  worker_key: string | null;
  content: string;
}

export default function ChatsClient() {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [newScope, setNewScope] = useState<string>("office");
  const [newTitle, setNewTitle] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const params = useSearchParams();

  const loadChats = useCallback(async () => {
    const res = await fetch("/api/chats");
    if (res.ok) {
      const d = await res.json();
      setChats(d.chats ?? []);
      return d.chats as ChatRow[];
    }
    return [];
  }, []);

  const loadThread = useCallback(async (id: string) => {
    const res = await fetch(`/api/chats/${id}`);
    if (res.ok) {
      const d = await res.json();
      setMessages(d.messages ?? []);
      setBusy(!!d.chat?.busy);
    }
  }, []);

  useEffect(() => {
    loadChats().then((list) => {
      const want = params.get("dept");
      if (want && !activeId) {
        const existing = list.find((c) => c.department === want);
        if (existing) setActiveId(existing.id);
        else createChat(want === "office" ? "office" : want, "General");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeId) return;
    loadThread(activeId);
    const t = setInterval(() => loadThread(activeId), 2000);
    return () => clearInterval(t);
  }, [activeId, loadThread]);

  useEffect(() => {
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function createChat(scope: string, title: string) {
    const body = scope === "office" ? { scope: "office", title } : { scope: "dept", department: scope, title };
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const { id } = await res.json();
      await loadChats();
      setActiveId(id);
      setCreating(false);
      setNewTitle("");
    }
  }

  async function send() {
    if (!activeId || !input.trim() || busy) return;
    const content = input.trim();
    setInput("");
    setMessages((m) => [...m, { id: Date.now(), role: "user", worker_key: null, content }]);
    setBusy(true);
    await fetch(`/api/chats/${activeId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    loadChats();
  }

  const active = chats.find((c) => c.id === activeId);
  const officeChats = chats.filter((c) => c.scope === "office");
  const deptChats = chats.filter((c) => c.scope === "dept");

  return (
    <div className="flex h-full">
      {/* chat list */}
      <aside
        className={`${activeId ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)] md:w-[250px]`}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <span className="font-pixel text-[8px] tracking-wider text-[var(--muted)]">CHATS</span>
          <button
            onClick={() => setCreating((v) => !v)}
            className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-bold text-white hover:brightness-110"
          >
            +
          </button>
        </div>

        {creating && (
          <div className="mx-3 mb-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
            <select
              value={newScope}
              onChange={(e) => setNewScope(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs outline-none"
            >
              <option value="office">🏢 Office · All-hands collab</option>
              {Object.values(departments).map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </select>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createChat(newScope, newTitle || "New chat")}
              placeholder={newScope === "office" ? "Idea name…" : "Project, e.g. Bika design"}
              className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={() => createChat(newScope, newTitle || "New chat")}
              className="mt-2 w-full rounded-lg bg-[var(--accent)] py-1.5 text-xs font-semibold text-white hover:brightness-110"
            >
              Create
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <p className="px-1 py-2 text-[10px] font-semibold tracking-wide text-[var(--muted)]">🏢 OFFICE COLLABS</p>
          {officeChats.map((c) => (
            <ChatItem key={c.id} chat={c} active={c.id === activeId} onClick={() => setActiveId(c.id)} />
          ))}
          {officeChats.length === 0 && <p className="px-1 text-[11px] text-[var(--muted)]">Drop an idea → the whole office debates it.</p>}

          <p className="px-1 py-2 text-[10px] font-semibold tracking-wide text-[var(--muted)]">DEPARTMENTS</p>
          {deptChats.map((c) => (
            <ChatItem key={c.id} chat={c} active={c.id === activeId} onClick={() => setActiveId(c.id)} />
          ))}
        </div>
      </aside>

      {/* thread */}
      <main className={`${activeId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {active ? (
          <>
            <header className="flex items-center gap-2.5 border-b border-[var(--border)] px-5 py-3.5">
              <button
                onClick={() => setActiveId(null)}
                className="mr-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:text-white md:hidden"
              >
                ←
              </button>
              <span className="text-base">{active.scope === "office" ? "🏢" : "👥"}</span>
              <div>
                <h1 className="text-sm font-semibold">{active.title}</h1>
                <p className="text-[11px] text-[var(--muted)]">
                  {active.scope === "office"
                    ? "All-hands collab — relevant agents join the discussion"
                    : departments[active.department as DeptKey]?.name}
                </p>
              </div>
              {busy && (
                <span className="ml-auto flex items-center gap-1.5 rounded-full border border-amber-600/40 px-2.5 py-1 text-[10px] text-amber-400">
                  <span className="led-blink h-1.5 w-1.5 rounded-full bg-amber-400" /> team discussing…
                </span>
              )}
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {messages.map((m) => (
                <Message key={m.id} msg={m} />
              ))}
              {busy && (
                <div className="flex items-center gap-2 pl-1 text-[11px] text-[var(--muted)]">
                  <span className="typing-dots" /> agents are typing
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-[var(--border)] p-4">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={2}
                  placeholder={
                    active.scope === "office"
                      ? "Pitch an idea — finance, research, product will weigh in…"
                      : "Message the team…"
                  }
                  className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-xs outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={send}
                  disabled={busy || !input.trim()}
                  className="rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40"
                >
                  ➤
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <span className="text-3xl">💬</span>
            <p className="text-sm text-[var(--muted)]">Pick a chat or create one.</p>
            <p className="max-w-xs text-[11px] text-[var(--muted)]">
              Office collabs pull agents from every relevant department to debate your idea. Department chats are
              project channels — one per topic.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function ChatItem({ chat, active, onClick }: { chat: ChatRow; active: boolean; onClick: () => void }) {
  const dept = chat.department ? departments[chat.department as DeptKey] : null;
  return (
    <button
      onClick={onClick}
      className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
        active ? "bg-[var(--accent)]/15" : "hover:bg-[var(--panel-2)]"
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${chat.busy ? "led-blink" : ""}`}
        style={{ background: chat.busy ? "#facc15" : dept?.accent ?? "#818cf8" }}
      />
      <span className="min-w-0">
        <span className="block truncate text-xs">{chat.title}</span>
        <span className="block text-[10px]" style={{ color: dept?.accent ?? "var(--muted)" }}>
          {dept?.name ?? "Office"}
        </span>
      </span>
    </button>
  );
}

function Message({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] rounded-2xl rounded-br-sm bg-[var(--accent)] px-4 py-2.5 text-xs leading-relaxed text-white">
          {msg.content}
        </div>
      </div>
    );
  }
  const w = msg.worker_key ? workers[msg.worker_key] : null;
  const dept = w ? departments[w.dept] : null;
  return (
    <div className="flex gap-2.5">
      <div
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
        style={{ background: dept?.accent ?? "#3a3f52" }}
      >
        {w ? w.name[0] : "⚙"}
      </div>
      <div className="min-w-0 max-w-[78%]">
        <p className="mb-1 text-[11px]">
          <span className="font-semibold" style={{ color: dept?.accent ?? "var(--accent)" }}>
            {w?.name ?? "Orchestrator"}
          </span>
          {w && <span className="ml-1.5 text-[var(--muted)]">{w.role} · {dept?.name}</span>}
        </p>
        <div className="deliverable rounded-2xl rounded-tl-sm border border-[var(--border)] bg-[var(--panel)] px-4 py-2.5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
