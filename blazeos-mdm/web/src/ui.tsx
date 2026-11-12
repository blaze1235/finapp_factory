import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Stat({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "danger" | "warn" | "good" }) {
  const toneClass = {
    default: "text-slate-900",
    danger: "text-red-600",
    warn: "text-amber-600",
    good: "text-emerald-600",
  }[tone];
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${toneClass}`}>{value}</div>
    </Card>
  );
}

const badgeTones: Record<string, string> = {
  UNLOCKED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  LOCKED: "bg-red-50 text-red-700 ring-red-600/20",
  RESTRICTED: "bg-amber-50 text-amber-700 ring-amber-600/20",
  ENROLLED: "bg-blue-50 text-blue-700 ring-blue-600/20",
  PENDING: "bg-slate-100 text-slate-600 ring-slate-500/20",
  REMOVED: "bg-slate-100 text-slate-500 ring-slate-500/20",
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  SUSPENDED: "bg-red-50 text-red-700 ring-red-600/20",
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  PAID_OFF: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  DUE: "bg-slate-100 text-slate-600 ring-slate-500/20",
  OVERDUE: "bg-red-50 text-red-700 ring-red-600/20",
  DEFAULTED: "bg-red-50 text-red-700 ring-red-600/20",
  CANCELLED: "bg-slate-100 text-slate-500 ring-slate-500/20",
};

export function Badge({ value }: { value: string }) {
  const tone = badgeTones[value] ?? "bg-slate-100 text-slate-600 ring-slate-500/20";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      {value}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "danger" | "ghost" | "success";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-dark",
    danger: "bg-red-600 text-white hover:bg-red-700",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    ghost: "bg-slate-100 text-slate-700 hover:bg-slate-200",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  );
}

export function money(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : v;
  return new Intl.NumberFormat("en-US").format(n) + " so'm";
}
