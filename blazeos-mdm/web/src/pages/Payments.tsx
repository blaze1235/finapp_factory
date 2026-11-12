import { useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Button, Card, money } from "../ui";

interface Payment {
  id: string;
  amount: string;
  dueDate: string;
  paidDate: string | null;
  status: string;
  contract: {
    buyer: { fullName: string };
    device: { imei: string };
  };
}

export function Payments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setPayments(await api.get<Payment[]>("/payments"));
  }
  useEffect(() => {
    load();
  }, []);

  async function pay(id: string) {
    setBusy(id);
    setMsg(null);
    try {
      const r = await api.post<{ unlocked: boolean; paidOff: boolean }>(`/payments/${id}/pay`, {
        method: "CASH",
      });
      setMsg(
        r.paidOff
          ? "Payment recorded — contract fully paid off."
          : r.unlocked
            ? "Payment recorded — device unlocked automatically."
            : "Payment recorded."
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  const sorted = [...payments].sort((a, b) => {
    const rank = (s: string) => (s === "OVERDUE" ? 0 : s === "DUE" ? 1 : 2);
    return rank(a.status) - rank(b.status) || +new Date(a.dueDate) - +new Date(b.dueDate);
  });

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Payments</h1>
      <p className="mb-6 text-sm text-slate-500">
        Recording a payment that clears all overdue amounts unlocks the device automatically.
      </p>
      {msg && <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{msg}</div>}
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-medium">Buyer</th>
              <th className="px-4 py-3 font-medium">Due date</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium">{p.contract.buyer.fullName}</td>
                <td className="px-4 py-3 text-slate-600">
                  {new Date(p.dueDate).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">{money(p.amount)}</td>
                <td className="px-4 py-3">
                  <Badge value={p.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  {p.status !== "PAID" ? (
                    <Button onClick={() => pay(p.id)} disabled={busy === p.id}>
                      {busy === p.id ? "…" : "Mark paid"}
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-400">
                      {p.paidDate ? new Date(p.paidDate).toLocaleDateString() : "paid"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No payments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
