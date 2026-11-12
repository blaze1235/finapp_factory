import { useEffect, useState } from "react";
import { Lock, Unlock, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card } from "../ui";

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
      <h1 className="mb-1 text-2xl font-semibold">Devices</h1>
      <p className="mb-6 text-sm text-slate-500">
        {canControl
          ? "Lock or unlock financed iPhones. Staff can enroll but not lock."
          : "You can enroll devices at point of sale. Locking is restricted to the store admin."}
      </p>
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
