"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const items = [
  { href: "/office", label: "Office HQ", icon: "🏢" },
  { href: "/chats", label: "Chats", icon: "💬" },
  { href: "/agents", label: "AI Agents", icon: "🧑‍💻" },
  { href: "/notes", label: "Brain Net", icon: "🕸️" },
  { href: "/finance", label: "Finances", icon: "💰" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <nav className="flex w-[176px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]">
      <div className="px-4 pb-4 pt-5">
        <div className="font-pixel text-[11px] leading-4 text-[var(--accent)]">AI OS</div>
        <div className="mt-1 text-[10px] text-[var(--muted)]">Project Ablaze HQ</div>
      </div>
      <div className="flex-1 space-y-1 px-2">
        {items.map((it) => {
          const active = pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
                active
                  ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-white"
              }`}
            >
              <span className="text-sm">{it.icon}</span>
              {it.label}
            </Link>
          );
        })}
      </div>
      <button
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          router.push("/login");
        }}
        className="mx-2 mb-4 flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs text-[var(--muted)] transition hover:bg-[var(--panel-2)] hover:text-white"
      >
        <span className="text-sm">🚪</span> Log out
      </button>
    </nav>
  );
}
