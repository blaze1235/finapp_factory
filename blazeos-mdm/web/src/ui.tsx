import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

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

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const fieldLabel = "block text-sm font-medium text-slate-700";
const fieldInput =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="mb-3 block">
      <span className={fieldLabel}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={fieldInput} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={fieldInput} />;
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div>;
}
