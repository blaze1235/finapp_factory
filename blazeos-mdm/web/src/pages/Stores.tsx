import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "../api";
import { Badge, Button, Card, Field, FormError, Modal, SelectInput, TextInput } from "../ui";

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
  const [adding, setAdding] = useState(false);

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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stores</h1>
          <p className="text-sm text-slate-500">
            Partner stores (tenants). Each sees only its own buyers and devices.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} /> Add store
        </Button>
      </div>

      {adding && (
        <AddStore
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}

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

function AddStore({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: "",
    contactName: "",
    contactPhone: "",
    telegramChatId: "",
    monthlyFeeAmount: "15000",
    billingPlan: "PER_DEVICE_MONTH",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const hasAdmin = form.adminEmail && form.adminPassword && form.adminName;
      await api.post("/stores", {
        name: form.name,
        contactName: form.contactName || undefined,
        contactPhone: form.contactPhone || undefined,
        telegramChatId: form.telegramChatId || undefined,
        monthlyFeeAmount: Number(form.monthlyFeeAmount),
        billingPlan: form.billingPlan,
        ...(hasAdmin
          ? {
              adminName: form.adminName,
              adminEmail: form.adminEmail,
              adminPassword: form.adminPassword,
            }
          : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add store" onClose={onClose}>
      <form onSubmit={submit}>
        <FormError message={error} />
        <Field label="Store name">
          <TextInput value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Contact name">
              <TextInput value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Contact phone">
              <TextInput value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Fee per device/mo (so'm)">
              <TextInput
                type="number"
                value={form.monthlyFeeAmount}
                onChange={(e) => set("monthlyFeeAmount", e.target.value)}
                min={0}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Telegram chat ID" hint="Optional.">
              <TextInput value={form.telegramChatId} onChange={(e) => set("telegramChatId", e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="my-3 border-t border-slate-100 pt-3 text-xs font-medium uppercase tracking-wide text-slate-400">
          First store admin (optional)
        </div>
        <Field label="Admin name">
          <TextInput value={form.adminName} onChange={(e) => set("adminName", e.target.value)} />
        </Field>
        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Admin email">
              <TextInput type="email" value={form.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Admin password" hint="Min 6 characters.">
              <TextInput
                type="password"
                value={form.adminPassword}
                onChange={(e) => set("adminPassword", e.target.value)}
              />
            </Field>
          </div>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Add store"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
