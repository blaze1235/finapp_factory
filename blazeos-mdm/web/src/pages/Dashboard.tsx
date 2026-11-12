import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Play, Lock, Unlock, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Button, Card, Stat } from "../ui";

interface Summary {
  scope: string;
  stores: number;
  devices: number;
  enrolled: number;
  locked: number;
  activeContracts: number;
  overduePayments: number;
}

interface Event {
  id: string;
  action: string;
  triggeredBy: string;
  reason?: string;
  createdAt: string;
  device: { imei: string; model?: string };
  store?: { name: string };
  user?: { name: string } | null;
}

const actionIcon: Record<string, any> = {
  LOCK: Lock,
  UNLOCK: Unlock,
  ENROLL: ShieldCheck,
  REMOVE: Trash2,
  RESTRICT: Lock,
};

export function Dashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const [s, e] = await Promise.all([
      api.get<Summary>("/dashboard"),
      api.get<Event[]>("/dashboard/events"),
    ]);
    setSummary(s);
    setEvents(e);
  }

  useEffect(() => {
    load();
  }, []);

  async function evaluate() {
    setRunning(true);
    setMsg(null);
    try {
      const r = await api.post<{ locked: string[]; unlocked: string[]; contractsChecked: number }>(
        "/dashboard/evaluate-overdue"
      );
      setMsg(
        `Checked ${r.contractsChecked} contracts — locked ${r.locked.length}, unlocked ${r.unlocked.length}.`
      );
      await load();
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-500">
            {summary?.scope === "platform" ? "All stores" : user?.storeName}
          </p>
        </div>
        <Button onClick={evaluate} disabled={running}>
          <Play size={16} /> {running ? "Running…" : "Run overdue check"}
        </Button>
      </div>

      {msg && (
        <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">{msg}</div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {user?.role === "MAIN_ADMIN" && <Stat label="Stores" value={summary?.stores ?? "—"} />}
        <Stat label="Devices" value={summary?.devices ?? "—"} />
        <Stat label="Enrolled" value={summary?.enrolled ?? "—"} tone="good" />
        <Stat label="Locked" value={summary?.locked ?? "—"} tone={summary?.locked ? "danger" : "default"} />
        <Stat label="Active contracts" value={summary?.activeContracts ?? "—"} />
        <Stat
          label="Overdue payments"
          value={summary?.overduePayments ?? "—"}
          tone={summary?.overduePayments ? "warn" : "default"}
        />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Recent activity</h2>
      <Card>
        {events.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No events yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {events.map((e) => {
              const Icon = actionIcon[e.action] ?? ShieldCheck;
              return (
                <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <Icon size={16} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">
                      {e.action}{" "}
                      <span className="font-normal text-slate-500">
                        · {e.device.model ?? e.device.imei}
                        {e.store ? ` · ${e.store.name}` : ""}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {e.triggeredBy === "SYSTEM" ? "Automated" : e.user?.name ?? "User"}
                      {e.reason ? ` — ${e.reason}` : ""}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400">
                    {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
