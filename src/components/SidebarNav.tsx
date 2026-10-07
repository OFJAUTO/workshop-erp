"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

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
            className={`whitespace-nowrap rounded-control px-3.5 py-2.5 text-sm font-semibold transition-colors ${
              active ? "bg-white text-ink" : "text-white/85 hover:bg-white/10 hover:text-white"
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
