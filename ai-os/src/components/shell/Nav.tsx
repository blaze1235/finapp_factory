"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const items = [
  { href: "/office", label: "Office", icon: "🏢" },
  { href: "/projects", label: "Projects", icon: "🚀" },
  { href: "/chats", label: "Chats", icon: "💬" },
  { href: "/agents", label: "Agents", icon: "🧑‍💻" },
  { href: "/reports", label: "Reports", icon: "📊" },
  { href: "/server", label: "Server", icon: "🗄️" },
  { href: "/notes", label: "Brain Net", icon: "🕸️" },
  { href: "/finance", label: "Finances", icon: "💰" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-[var(--border)]
                 bg-[var(--panel)] px-1 py-1 md:static md:inset-auto md:z-auto md:w-[176px] md:shrink-0
                 md:flex-col md:items-stretch md:justify-start md:border-r md:border-t-0 md:px-2 md:py-0"
    >
      <div className="hidden px-2 pb-4 pt-5 md:block">
        <div className="font-pixel text-[11px] leading-4 text-[var(--accent)]">AI OS</div>
        <div className="mt-1 text-[10px] text-[var(--muted)]">Project Ablaze HQ</div>
      </div>

      <div className="flex flex-1 items-stretch justify-around md:block md:flex-none md:space-y-1">
        {items.map((it) => {
          const active = pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[9px] font-medium transition
                          md:flex-row md:justify-start md:gap-2.5 md:px-3 md:py-2 md:text-xs ${
                active
                  ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-white"
              }`}
            >
              <span className="text-base md:text-sm">{it.icon}</span>
              <span className="leading-none">{it.label}</span>
            </Link>
          );
        })}
        <button
          onClick={logout}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[9px] font-medium text-[var(--muted)]
                     transition hover:bg-[var(--panel-2)] hover:text-white md:hidden"
        >
          <span className="text-base">🚪</span>
          <span className="leading-none">Log out</span>
        </button>
      </div>

      <button
        onClick={logout}
        className="mx-2 mb-4 mt-auto hidden items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs text-[var(--muted)]
                   transition hover:bg-[var(--panel-2)] hover:text-white md:flex"
      >
        <span className="text-sm">🚪</span> Log out
      </button>
    </nav>
  );
}
