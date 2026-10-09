"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** A menu entry; `badge` is a count of things waiting there (for example price requests for Parts). */
export type NavItem = { href: string; label: string; badge?: number };

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-row md:flex-col gap-1 shrink-0">
      {items.map((n) => {
        const active = pathname === n.href || (n.href !== "/home" && pathname.startsWith(n.href + "/")) || (n.href !== "/home" && pathname === n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`whitespace-nowrap rounded-control px-3.5 py-2.5 text-sm font-semibold transition-colors flex items-center gap-2 ${
              active ? "bg-white text-ink" : "text-white/85 hover:bg-white/10 hover:text-white"
            }`}
          >
            {n.label}
            {n.badge ? <span className={`ml-auto min-w-5 h-5 rounded-full px-1.5 text-[11px] font-bold flex items-center justify-center ${active ? "bg-ink text-white" : "bg-red-bar text-white"}`}>{n.badge > 99 ? "99+" : n.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
