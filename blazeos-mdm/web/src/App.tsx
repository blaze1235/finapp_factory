import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  LayoutDashboard,
  Smartphone,
  Users,
  FileText,
  Wallet,
  Store,
  Receipt,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { useAuth, roleLabel } from "./auth";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Devices } from "./pages/Devices";
import { Buyers } from "./pages/Buyers";
import { Contracts } from "./pages/Contracts";
import { Payments } from "./pages/Payments";
import { Billing } from "./pages/Billing";
import { Stores } from "./pages/Stores";

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>;
  }
  if (!user) return <Login />;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/devices" element={<Devices />} />
            <Route path="/buyers" element={<Buyers />} />
            <Route path="/contracts" element={<Contracts />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/billing" element={<Billing />} />
            {user.role === "MAIN_ADMIN" && <Route path="/stores" element={<Stores />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function Sidebar() {
  const { user, logout } = useAuth();
  const items = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/devices", label: "Devices", icon: Smartphone },
    { to: "/buyers", label: "Buyers", icon: Users },
    { to: "/contracts", label: "Contracts", icon: FileText },
    { to: "/payments", label: "Payments", icon: Wallet },
    { to: "/billing", label: "Billing", icon: Receipt },
    ...(user?.role === "MAIN_ADMIN" ? [{ to: "/stores", label: "Stores", icon: Store }] : []),
  ];

  return (
    <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
          <ShieldCheck size={18} />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">BlazeOS</div>
          <div className="text-xs text-slate-400 leading-tight">MDM</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={(it as any).end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                isActive ? "bg-brand/10 text-brand" : "text-slate-600 hover:bg-slate-100"
              }`
            }
          >
            <it.icon size={18} />
            {it.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <div className="px-2 pb-2">
          <div className="text-sm font-medium text-slate-700">{user?.name}</div>
          <div className="text-xs text-slate-400">
            {user ? roleLabel[user.role] : ""}
            {user?.storeName ? ` · ${user.storeName}` : ""}
          </div>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </aside>
  );
}
