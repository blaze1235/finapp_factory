import { useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Button, Card } from "../ui";

interface Store {
  id: string;
  name: string;
  contactName?: string;
  contactPhone?: string;
  billingPlan: string;
  status: string;
  _count: { devices: number; buyers: number; users: number };
}

export function Stores() {
  const [stores, setStores] = useState<Store[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setStores(await api.get<Store[]>("/stores"));
  }
  useEffect(() => {
    load();
  }, []);

  async function toggle(s: Store) {
    setBusy(s.id);
    try {
      await api.patch(`/stores/${s.id}/status`, {
        status: s.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Stores</h1>
      <p className="mb-6 text-sm text-slate-500">
        Partner stores (tenants). Each sees only its own buyers and devices.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {stores.map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold">{s.name}</div>
                <div className="text-sm text-slate-500">
                  {s.contactName}
                  {s.contactPhone ? ` · ${s.contactPhone}` : ""}
                </div>
              </div>
              <Badge value={s.status} />
            </div>
            <div className="mt-3 flex gap-4 text-sm text-slate-600">
              <span>
                <b>{s._count.devices}</b> devices
              </span>
              <span>
                <b>{s._count.buyers}</b> buyers
              </span>
              <span>
                <b>{s._count.users}</b> users
              </span>
            </div>
            <div className="mt-3 text-xs text-slate-400">Billing: {s.billingPlan}</div>
            <div className="mt-4">
              <Button
                variant={s.status === "ACTIVE" ? "danger" : "success"}
                onClick={() => toggle(s)}
                disabled={busy === s.id}
              >
                {s.status === "ACTIVE" ? "Suspend" : "Reactivate"}
              </Button>
            </div>
          </Card>
        ))}
        {stores.length === 0 && (
          <Card className="p-8 text-center text-slate-400">No stores yet.</Card>
        )}
      </div>
    </div>
  );
}
