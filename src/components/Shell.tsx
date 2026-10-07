import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { Avatar } from "./ui";
import { SidebarNav, type NavItem } from "./SidebarNav";
import { NotificationBell } from "./NotificationBell";

/**
 * Black menu bar down the left, content using the full width.
 * On narrow screens the bar sits across the top instead.
 */
export function Shell({
  nav = [],
  user,
  footer,
  children,
}: {
  nav?: NavItem[];
  user?: { id: string; name: string; role: string; photoUrl: string | null };
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="bg-sidebar text-white flex flex-row md:flex-col items-center md:items-stretch gap-3 md:gap-6 px-4 py-3 md:px-5 md:py-6 md:w-60 md:shrink-0 md:h-screen md:sticky md:top-0 overflow-x-auto md:overflow-y-auto">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <Link href="/home" className="shrink-0 flex items-center" aria-label="Home">
            <Logo onDark className="h-9 md:h-12" />
          </Link>
        </div>
        {nav.length ? <SidebarNav items={nav} /> : null}
        {user ? (
          <div className="md:mt-auto flex items-center gap-3 shrink-0 md:border-t md:border-white/15 md:pt-5">
            <Avatar name={user.name} photoUrl={user.photoUrl} size={40} />
            <span className="hidden md:flex flex-col leading-tight min-w-0">
              <span className="text-sm font-bold truncate">{user.name}</span>
              <span className="text-xs text-white/70 truncate">{user.role}</span>
            </span>
          </div>
        ) : null}
        {footer ? <div className="shrink-0 ml-auto md:ml-0">{footer}</div> : null}
      </aside>
      <main className="flex-1 min-w-0 flex flex-col relative">
        {/* Bell at the top right of the page area, level with the page title. */}
        {user ? (
          <div className="absolute top-5 right-4 sm:right-6 lg:right-8 z-30">
            <NotificationBell staffId={user.id} />
          </div>
        ) : null}
        <div className="flex-1 flex flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}

/** Same bar without a menu, for the login, tablet and setup pages. */
export function PublicShell({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="bg-sidebar text-white flex flex-row md:flex-col items-center md:items-start gap-3 px-4 py-3 md:px-5 md:py-6 md:w-60 md:shrink-0 md:h-screen md:sticky md:top-0">
        <Logo onDark className="h-9 md:h-12" />
        {note ? <span className="text-xs text-white/70 md:mt-2">{note}</span> : null}
      </aside>
      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </div>
  );
}
