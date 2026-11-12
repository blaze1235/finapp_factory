import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "../auth";
import { Button } from "../ui";

const demos = [
  { label: "Main Admin", email: "admin@blazeos.dev", password: "admin123" },
  { label: "Store Admin", email: "admin@tashkentmobile.uz", password: "store123" },
  { label: "Store Staff", email: "staff@tashkentmobile.uz", password: "store123" },
];

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("admin@blazeos.dev");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="text-lg font-semibold leading-tight">BlazeOS MDM</div>
            <div className="text-xs text-slate-400">Device financing control</div>
          </div>
        </div>
        <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium text-slate-700">Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            type="email"
          />
          <label className="mt-4 block text-sm font-medium text-slate-700">Password</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            type="password"
          />
          {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
          <div className="mt-5">
            <Button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </div>
        </form>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Demo accounts
          </div>
          <div className="space-y-1">
            {demos.map((d) => (
              <button
                key={d.email}
                onClick={() => {
                  setEmail(d.email);
                  setPassword(d.password);
                }}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-700">{d.label}</span>
                <span className="text-xs text-slate-400">{d.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
