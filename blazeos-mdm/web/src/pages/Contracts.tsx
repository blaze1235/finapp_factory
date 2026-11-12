import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { useStores } from "../useStores";
import { Badge, Button, Card, Field, FormError, Modal, SelectInput, TextInput, money } from "../ui";

interface BuyerOption {
  id: string;
  fullName: string;
  storeId: string;
}
interface DeviceOption {
  id: string;
  imei: string;
  model?: string;
  storeId: string;
  buyerId?: string | null;
  contract?: { status: string } | null;
}

interface Payment {
  status: string;
  amount: string;
  dueDate: string;
  paidDate: string | null;
}
interface Contract {
  id: string;
  totalPrice: string;
  downPayment: string;
  termMonths: number;
  monthlyAmount: string;
  status: string;
  buyer: { fullName: string };
  device: { imei: string; model?: string; lockState: string };
  payments: Payment[];
}

export function Contracts() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [adding, setAdding] = useState(false);

  async function load() {
    setContracts(await api.get<Contract[]>("/contracts"));
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contracts</h1>
          <p className="text-sm text-slate-500">Installment agreements and their payment progress.</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} /> New contract
        </Button>
      </div>

      {adding && (
        <AddContract
          isMain={user?.role === "MAIN_ADMIN"}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      <div className="space-y-4">
        {contracts.map((c) => {
          const paid = c.payments.filter((p) => p.status === "PAID").length;
          const overdue = c.payments.filter((p) => p.status === "OVERDUE").length;
          return (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">
                    {c.buyer.fullName}{" "}
                    <span className="text-slate-400">· {c.device.model ?? c.device.imei}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {money(c.totalPrice)} total · {money(c.downPayment)} down · {money(c.monthlyAmount)}/mo ×{" "}
                    {c.termMonths}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge value={c.device.lockState} />
                  <Badge value={c.status} />
                </div>
              </div>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>
                    {paid} / {c.termMonths} paid
                    {overdue > 0 && <span className="ml-2 text-red-600">{overdue} overdue</span>}
                  </span>
                </div>
                <div className="flex gap-1">
                  {c.payments.map((p, i) => (
                    <div
                      key={i}
                      title={`${new Date(p.dueDate).toLocaleDateString()} · ${p.status}`}
                      className={`h-2 flex-1 rounded-full ${
                        p.status === "PAID"
                          ? "bg-emerald-500"
                          : p.status === "OVERDUE"
                            ? "bg-red-500"
                            : "bg-slate-200"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </Card>
          );
        })}
        {contracts.length === 0 && (
          <Card className="p-8 text-center text-slate-400">No contracts yet.</Card>
        )}
      </div>
    </div>
  );
}

function AddContract({
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
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [form, setForm] = useState({
    storeId: "",
    buyerId: "",
    deviceId: "",
    totalPrice: "",
    downPayment: "0",
    termMonths: "12",
    startDate: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<BuyerOption[]>("/buyers").then(setBuyers).catch(() => setBuyers([]));
    api.get<DeviceOption[]>("/devices").then(setDevices).catch(() => setDevices([]));
  }, []);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const inStore = (storeId: string) => !isMain || !form.storeId || storeId === form.storeId;
  const buyerOptions = buyers.filter((b) => inStore(b.storeId));
  // Only devices with no existing contract can start a new one.
  const deviceOptions = devices.filter((d) => inStore(d.storeId) && !d.contract);

  const financed = Number(form.totalPrice || 0) - Number(form.downPayment || 0);
  const monthly = Number(form.termMonths) > 0 ? financed / Number(form.termMonths) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/contracts", {
        ...(isMain ? { storeId: form.storeId } : {}),
        buyerId: form.buyerId,
        deviceId: form.deviceId,
        totalPrice: Number(form.totalPrice),
        downPayment: Number(form.downPayment),
        termMonths: Number(form.termMonths),
        startDate: form.startDate,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New contract" onClose={onClose}>
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
        <Field label="Buyer">
          <SelectInput value={form.buyerId} onChange={(e) => set("buyerId", e.target.value)} required>
            <option value="">Select a buyer…</option>
            {buyerOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.fullName}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Device" hint="Only devices without a contract are shown.">
          <SelectInput value={form.deviceId} onChange={(e) => set("deviceId", e.target.value)} required>
            <option value="">Select a device…</option>
            {deviceOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.model ?? "iPhone"} · {d.imei}
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Total price (so'm)">
              <TextInput
                type="number"
                value={form.totalPrice}
                onChange={(e) => set("totalPrice", e.target.value)}
                required
                min={1}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Down payment">
              <TextInput
                type="number"
                value={form.downPayment}
                onChange={(e) => set("downPayment", e.target.value)}
                min={0}
              />
            </Field>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Term (months)">
              <TextInput
                type="number"
                value={form.termMonths}
                onChange={(e) => set("termMonths", e.target.value)}
                required
                min={1}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Start date">
              <TextInput
                type="date"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                required
              />
            </Field>
          </div>
        </div>
        {financed > 0 && Number(form.termMonths) > 0 && (
          <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {money(Math.round(monthly))}/month × {form.termMonths} = {money(financed)} financed
          </div>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Create contract"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
