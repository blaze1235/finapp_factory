"use client";

import { useCallback, useEffect, useState } from "react";

interface Tx {
  id: string;
  kind: "income" | "expense";
  amount: string;
  currency: string;
  category: string;
  note: string | null;
  occurred_on: string;
}

interface SummaryRow {
  currency: string;
  kind: string;
  total: string;
}

const CATEGORIES = ["blazerent", "finly", "finapp", "bika", "export", "marketing", "infra", "personal", "other"];

export default function FinanceClient() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [form, setForm] = useState({ kind: "expense", amount: "", currency: "UZS", category: "other", note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/finance");
    if (res.ok) {
      const d = await res.json();
      setTxs(d.transactions ?? []);
      setSummary(d.summary ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!form.amount || busy) return;
    setBusy(true);
    await fetch("/api/finance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    setForm((f) => ({ ...f, amount: "", note: "" }));
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/finance?id=${id}`, { method: "DELETE" });
    load();
  }

  const currencies = [...new Set(summary.map((s) => s.currency))];

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-[var(--border)] px-5 py-3.5">
        <h1 className="text-sm font-semibold">💰 Finances</h1>
        <p className="text-[11px] text-[var(--muted)]">Personal + portfolio cash tracking. This month's summary below.</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {/* month summary */}
        <div className="flex flex-wrap gap-3">
          {currencies.length === 0 && (
            <p className="text-xs text-[var(--muted)]">No transactions yet — add your first one below.</p>
          )}
          {currencies.map((cur) => {
            const inc = Number(summary.find((s) => s.currency === cur && s.kind === "income")?.total ?? 0);
            const exp = Number(summary.find((s) => s.currency === cur && s.kind === "expense")?.total ?? 0);
            return (
              <div key={cur} className="min-w-[200px] rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <p className="font-pixel text-[8px] tracking-wider text-[var(--muted)]">{cur} · THIS MONTH</p>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="text-sm font-bold text-emerald-400">+{inc.toLocaleString()}</span>
                  <span className="text-sm font-bold text-red-400">−{exp.toLocaleString()}</span>
                </div>
                <p className={`mt-1 text-xs font-semibold ${inc - exp >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                  net {(inc - exp).toLocaleString()} {cur}
                </p>
              </div>
            );
          })}
        </div>

        {/* add form */}
        <div className="mt-5 flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
          <div>
            <label className="text-[10px] text-[var(--muted)]">Type</label>
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="block rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-xs outline-none"
            >
              <option value="expense">− Expense</option>
              <option value="income">+ Income</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[var(--muted)]">Amount</label>
            <input
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, "") })}
              placeholder="0"
              className="block w-28 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--muted)]">Currency</label>
            <select
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              className="block rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-xs outline-none"
            >
              {["UZS", "USD", "EUR", "RUB"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[var(--muted)]">Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="block rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-xs outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[160px] flex-1">
            <label className="text-[10px] text-[var(--muted)]">Note</label>
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="optional"
              className="block w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
            />
          </div>
          <button
            onClick={add}
            disabled={busy || !form.amount}
            className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40"
          >
            Add
          </button>
        </div>

        {/* table */}
        <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="bg-[var(--panel)] text-[10px] uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 text-[var(--muted)]">{t.occurred_on?.slice(0, 10)}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[10px]">{t.category}</span>
                  </td>
                  <td className="px-3 py-2 text-[var(--muted)]">{t.note}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${t.kind === "income" ? "text-emerald-400" : "text-red-400"}`}>
                    {t.kind === "income" ? "+" : "−"}
                    {Number(t.amount).toLocaleString()} {t.currency}
                  </td>
                  <td className="px-2 py-2">
                    <button onClick={() => remove(t.id)} className="text-[var(--muted)] hover:text-red-400">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {txs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-[var(--muted)]">
                    Nothing here yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
