import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { useStores } from "../useStores";
import { Button, Card, Field, FormError, Modal, SelectInput, TextInput } from "../ui";

interface Buyer {
  id: string;
  fullName: string;
  idNumber: string;
  phone: string;
  store?: { name: string };
  _count: { devices: number; contracts: number };
}

export function Buyers() {
  const { user } = useAuth();
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [adding, setAdding] = useState(false);

  async function load() {
    setBuyers(await api.get<Buyer[]>("/buyers"));
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Buyers</h1>
          <p className="text-sm text-slate-500">People financing a device through a partner store.</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} /> Add buyer
        </Button>
      </div>

      {adding && (
        <AddBuyer
          isMain={user?.role === "MAIN_ADMIN"}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">ID number</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Devices</th>
              <th className="px-4 py-3 font-medium">Contracts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {buyers.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-3 font-medium">{b.fullName}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{b.idNumber}</td>
                <td className="px-4 py-3 text-slate-600">{b.phone}</td>
                <td className="px-4 py-3">{b._count.devices}</td>
                <td className="px-4 py-3">{b._count.contracts}</td>
              </tr>
            ))}
            {buyers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No buyers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function AddBuyer({
  isMain,
  onClose,
  onSaved,
}: {
  isMain: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const stores = useStores();
  const [form, setForm] = useState({
    storeId: "",
    fullName: "",
    idNumber: "",
    phone: "",
    telegramChatId: "",
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
      await api.post("/buyers", {
        ...(isMain ? { storeId: form.storeId } : {}),
        fullName: form.fullName,
        idNumber: form.idNumber,
        phone: form.phone,
        telegramChatId: form.telegramChatId || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add buyer" onClose={onClose}>
      <form onSubmit={submit}>
        <FormError message={error} />
        {isMain && (
          <Field label="Store">
            <SelectInput value={form.storeId} onChange={(e) => set("storeId", e.target.value)} required>
              <option value="">Select a store…</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}
        <Field label="Full name">
          <TextInput value={form.fullName} onChange={(e) => set("fullName", e.target.value)} required />
        </Field>
        <Field label="ID / passport number">
          <TextInput value={form.idNumber} onChange={(e) => set("idNumber", e.target.value)} required />
        </Field>
        <Field label="Phone">
          <TextInput value={form.phone} onChange={(e) => set("phone", e.target.value)} required />
        </Field>
        <Field label="Telegram chat ID" hint="Optional — for lock/unlock alerts.">
          <TextInput value={form.telegramChatId} onChange={(e) => set("telegramChatId", e.target.value)} />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Add buyer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
