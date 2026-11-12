import { useEffect, useState } from "react";
import { Receipt, Play } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Button, Card, Stat, money } from "../ui";

interface StoreBilling {
  storeId: string;
  storeName: string;
  period: string;
  deviceCount: number;
  total: number;
}
interface SummaryResp {
  currentPeriod: string;
  rows: StoreBilling[];
}

export function Billing() {
  const { user } = useAuth();
  const isMain = user?.role === "MAIN_ADMIN";
  const [data, setData] = useState<SummaryResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setData(await api.get<SummaryResp>("/billing/summary"));
  }
  useEffect(() => {
    load();
  }, []);

  async function generate() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{
        period: string;
        devicesCharged: number;
        skippedExisting: number;
        totalAmount: number;
      }>("/billing/generate", {});
      setMsg(
        `Period ${r.period}: charged ${r.devicesCharged} device(s) (${money(r.totalAmount)}), skipped ${r.skippedExisting} already billed.`
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.rows ?? [];
  const currentRows = rows.filter((r) => r.period === data?.currentPeriod);
  const grandTotal = currentRows.reduce((s, r) => s + r.total, 0);
  const deviceTotal = currentRows.reduce((s, r) => s + r.deviceCount, 0);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Billing</h1>
          <p className="text-sm text-slate-500">
            {isMain
              ? "Per-device monthly fees BlazeOS charges each store."
              : "Your platform fees owed to BlazeOS."}
          </p>
        </div>
        {isMain && (
          <Button onClick={generate} disabled={busy}>
            <Play size={16} /> {busy ? "Generating…" : `Generate ${data?.currentPeriod ?? ""}`}
          </Button>
        )}
      </div>

      {msg && <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">{msg}</div>}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label={`Billed devices (${data?.currentPeriod ?? ""})`} value={deviceTotal} />
        <Stat label="Total this period" value={money(grandTotal)} tone="good" />
        {isMain && <Stat label="Stores billed" value={currentRows.length} />}
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              {isMain && <th className="px-4 py-3 font-medium">Store</th>}
              <th className="px-4 py-3 font-medium">Period</th>
              <th className="px-4 py-3 font-medium">Devices</th>
              <th className="px-4 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={`${r.storeId}:${r.period}`} className={r.period === data?.currentPeriod ? "" : "text-slate-400"}>
                {isMain && <td className="px-4 py-3 font-medium">{r.storeName}</td>}
                <td className="px-4 py-3">
                  {r.period}
                  {r.period === data?.currentPeriod && (
                    <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">
                      current
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{r.deviceCount}</td>
                <td className="px-4 py-3 text-right font-medium">{money(r.total)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={isMain ? 4 : 3} className="px-4 py-8 text-center text-slate-400">
                  No charges yet. {isMain && "Click Generate to bill this period."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <Receipt size={14} />
        Charges are generated per month, one per enrolled device, at each store's rate. Running
        generation again for the same period never double-charges.
      </div>
    </div>
  );
}
