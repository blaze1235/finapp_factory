import { useEffect, useState } from "react";
import { api } from "../api";
import { Card } from "../ui";

interface Buyer {
  id: string;
  fullName: string;
  idNumber: string;
  phone: string;
  store?: { name: string };
  _count: { devices: number; contracts: number };
}

export function Buyers() {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  useEffect(() => {
    api.get<Buyer[]>("/buyers").then(setBuyers);
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Buyers</h1>
      <p className="mb-6 text-sm text-slate-500">People financing a device through a partner store.</p>
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
