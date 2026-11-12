import { useEffect, useState } from "react";
import { Lock, Unlock, ShieldCheck, Plus } from "lucide-react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { useStores } from "../useStores";
import { Badge, Button, Card, Field, FormError, Modal, SelectInput, TextInput } from "../ui";

interface BuyerOption {
  id: string;
  fullName: string;
  storeId: string;
}

interface Device {
  id: string;
  imei: string;
  model?: string;
  enrollmentStatus: string;
  lockState: string;
  mdmProfileLocked: boolean;
  buyer?: { fullName: string; phone: string } | null;
  store?: { name: string };
  contract?: { status: string } | null;
}

export function Devices() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const canControl = user?.role === "MAIN_ADMIN" || user?.role === "STORE_ADMIN";

  async function load() {
    setDevices(await api.get<Device[]>("/devices"));
  }
  useEffect(() => {
    load();
  }, []);

  async function act(id: string, action: "lock" | "unlock" | "enroll") {
    setBusy(id + action);
    setError(null);
    try {
      await api.post(`/devices/${id}/${action}`, action === "lock" ? { reason: "Manual lock" } : {});
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Devices</h1>
          <p className="text-sm text-slate-500">
            {canControl
              ? "Lock or unlock financed iPhones. Staff can enroll but not lock."
              : "You can enroll devices at point of sale. Locking is restricted to the store admin."}
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} /> Add device
        </Button>
      </div>

      {adding && (
        <AddDevice
          isMain={user?.role === "MAIN_ADMIN"}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-medium">Device</th>
              <th className="px-4 py-3 font-medium">Buyer</th>
              {user?.role === "MAIN_ADMIN" && <th className="px-4 py-3 font-medium">Store</th>}
              <th className="px-4 py-3 font-medium">Enrollment</th>
              <th className="px-4 py-3 font-medium">Lock</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {devices.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{d.model ?? "iPhone"}</div>
                  <div className="font-mono text-xs text-slate-400">{d.imei}</div>
                </td>
                <td className="px-4 py-3">
                  {d.buyer ? (
                    <>
                      <div>{d.buyer.fullName}</div>
                      <div className="text-xs text-slate-400">{d.buyer.phone}</div>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                {user?.role === "MAIN_ADMIN" && (
                  <td className="px-4 py-3 text-slate-600">{d.store?.name}</td>
                )}
                <td className="px-4 py-3">
                  <Badge value={d.enrollmentStatus} />
                </td>
                <td className="px-4 py-3">
                  <Badge value={d.lockState} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {d.enrollmentStatus === "PENDING" && (
                      <Button variant="ghost" onClick={() => act(d.id, "enroll")} disabled={!!busy}>
                        <ShieldCheck size={14} /> Enroll
                      </Button>
                    )}
                    {canControl && d.enrollmentStatus === "ENROLLED" && d.lockState === "UNLOCKED" && (
                      <Button variant="danger" onClick={() => act(d.id, "lock")} disabled={!!busy}>
                        <Lock size={14} /> Lock
                      </Button>
                    )}
                    {canControl && d.lockState !== "UNLOCKED" && (
                      <Button variant="success" onClick={() => act(d.id, "unlock")} disabled={!!busy}>
                        <Unlock size={14} /> Unlock
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {devices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No devices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function AddDevice({
  isMain,
  onClose,
  onSaved,
}: {
  isMain: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const stores = useStores();
  const [buyers, setBuyers] = useState<BuyerOption[]>([]);
  const [form, setForm] = useState({ storeId: "", imei: "", model: "", serial: "", buyerId: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<BuyerOption[]>("/buyers").then(setBuyers).catch(() => setBuyers([]));
  }, []);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // For main admin, only show buyers in the selected store.
  const buyerOptions = isMain
    ? buyers.filter((b) => !form.storeId || b.storeId === form.storeId)
    : buyers;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/devices", {
        ...(isMain ? { storeId: form.storeId } : {}),
        imei: form.imei,
        model: form.model || undefined,
        serial: form.serial || undefined,
        buyerId: form.buyerId || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add device" onClose={onClose}>
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
        <Field label="IMEI" hint="15-digit device identifier (dial *#06#).">
          <TextInput value={form.imei} onChange={(e) => set("imei", e.target.value)} required minLength={10} />
        </Field>
        <Field label="Model">
          <TextInput
            value={form.model}
            onChange={(e) => set("model", e.target.value)}
            placeholder="iPhone 14 Pro"
          />
        </Field>
        <Field label="Serial">
          <TextInput value={form.serial} onChange={(e) => set("serial", e.target.value)} />
        </Field>
        <Field label="Buyer" hint="Optional — can be linked when the contract is created.">
          <SelectInput value={form.buyerId} onChange={(e) => set("buyerId", e.target.value)}>
            <option value="">No buyer yet</option>
            {buyerOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.fullName}
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Add device"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
