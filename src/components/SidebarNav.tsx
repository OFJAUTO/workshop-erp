"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";

/** A menu entry; `badge` is a count of things waiting there (for example price requests for Parts). */
export type NavItem = { href: string; label: string; badge?: number };
/**
 * One collapsible menu group (Mathew's "Parts management", 5 November 2026): the sub-items indent
 * under one main row whose badge is the sum of theirs. The group opens by itself on any of its
 * pages, a tap opens or closes it by hand, and every navigation lets it follow the page again.
 * THE shared shape - any later group is just another NavGroup in the list.
 */
export type NavGroup = { group: string; label: string; items: NavItem[] };
export type NavEntry = NavItem | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => "group" in e;
const activeOf = (pathname: string, href: string) => pathname === href || (href !== "/home" && pathname.startsWith(href + "/"));

function Pill({ n, dark }: { n: number; dark: boolean }) {
  return <span className={`min-w-5 h-5 rounded-full px-1.5 text-[11px] font-bold flex items-center justify-center ${dark ? "bg-ink text-white" : "bg-red-bar text-white"}`}>{n > 99 ? "99+" : n}</span>;
}

function ItemLink({ n, pathname, sub = false }: { n: NavItem; pathname: string; sub?: boolean }) {
  const active = activeOf(pathname, n.href);
  return (
    <Link
      href={n.href}
      className={`whitespace-nowrap rounded-control py-2.5 text-sm font-semibold transition-colors flex items-center gap-2 ${sub ? "pl-8 pr-3.5" : "px-3.5"} ${
        active ? "bg-white text-ink" : "text-white/85 hover:bg-white/10 hover:text-white"
      }`}
      data-nav-sub={sub ? "1" : undefined}
    >
      {n.label}
      {n.badge ? <span className="ml-auto flex"><Pill n={n.badge} dark={active} /></span> : null}
    </Link>
  );
}

function GroupRow({ g, pathname }: { g: NavGroup; pathname: string }) {
  const inside = g.items.some((n) => activeOf(pathname, n.href));
  // null = follow the page (open on its own pages); a tap decides until the next navigation,
  // when the group follows the page again (the prev-value setState-in-render pattern).
  const [manual, setManual] = useState<boolean | null>(null);
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setManual(null);
  }
  const open = manual ?? inside;
  const badge = g.items.reduce((t, n) => t + (n.badge ?? 0), 0);
  const headerActive = inside && !open;
  return (
    <div className="flex flex-col gap-1" data-nav-group={g.group} data-nav-group-open={open ? "1" : undefined}>
      <button
        type="button"
        onClick={() => setManual(!open)}
        className={`whitespace-nowrap rounded-control px-3.5 py-2.5 text-sm font-semibold transition-colors flex items-center gap-2 text-left ${
          headerActive ? "bg-white text-ink" : "text-white/85 hover:bg-white/10 hover:text-white"
        }`}
        data-nav-group-toggle
      >
        {g.label}
        <span className="ml-auto flex items-center gap-2">
          {badge ? <span data-nav-group-badge={badge}><Pill n={badge} dark={headerActive} /></span> : null}
          <span aria-hidden className="text-[10px]">{open ? "▴" : "▾"}</span>
        </span>
      </button>
      {open ? g.items.map((n) => <ItemLink key={n.href} n={n} pathname={pathname} sub />) : null}
    </div>
  );
}

export function SidebarNav({ items }: { items: NavEntry[]; /** Kept for the phone menu; the list is always one column now. */ vertical?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 shrink-0">
      {items.map((e) => (isGroup(e) ? <GroupRow key={e.group} g={e} pathname={pathname} /> : <ItemLink key={e.href} n={e} pathname={pathname} />))}
    </nav>
  );
}
