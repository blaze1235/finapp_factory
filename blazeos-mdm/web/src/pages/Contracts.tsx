import { useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Card, money } from "../ui";

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
  const [contracts, setContracts] = useState<Contract[]>([]);
  useEffect(() => {
    api.get<Contract[]>("/contracts").then(setContracts);
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Contracts</h1>
      <p className="mb-6 text-sm text-slate-500">Installment agreements and their payment progress.</p>
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
