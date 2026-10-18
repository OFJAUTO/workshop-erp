import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { Avatar } from "./ui";
import { SidebarNav, type NavItem } from "./SidebarNav";
import { BellDock } from "./BellDock";
import { NotificationBell } from "./NotificationBell";
import { ModeExit } from "./ModeExit";

/**
 * Black menu bar down the left, content using the full width.
 * On narrow screens the bar sits across the top instead.
 */
export function Shell({
  nav = [],
  user,
  footer,
  viewingAs = null,
  actingAs = null,
  sounds,
  children,
}: {
  nav?: NavItem[];
  user?: { id: string; name: string; role: string; photoUrl: string | null };
  footer?: ReactNode;
  /** The workshop's notification sounds from Settings. */
  sounds?: { tone: string; ownerTone: string; remindMinutes: number };
  /** The owner is looking at the system as this person (view only). */
  viewingAs?: { realId: string; realName: string } | null;
  /** The owner is doing this person's work from their screen; every change is logged on the owner's behalf. */
  actingAs?: { realId: string; realName: string; forName: string } | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="bg-sidebar text-white flex flex-row md:flex-col items-center md:items-stretch gap-3 md:gap-6 px-4 py-3 md:px-5 md:py-6 md:w-60 md:shrink-0 md:h-screen md:sticky md:top-0 overflow-x-auto md:overflow-y-auto">
        <div className="flex items-center justify-center gap-2 shrink-0 md:mb-2">
          <Link href="/home" className="shrink-0 flex items-center justify-center md:w-full" aria-label="Home">
            <Logo onDark className="h-11 md:h-15" />
          </Link>
        </div>
        {nav.length ? <SidebarNav items={nav} /> : null}
        {user ? (
          // The name or photo opens a small menu with Sign out, so nothing on the page can ever cover it.
          <details className="relative shrink-0 ml-auto md:ml-0 md:mt-auto md:border-t md:border-white/15 md:pt-5">
            <summary className="list-none cursor-pointer flex items-center gap-3 min-h-11 rounded-control px-1 hover:bg-white/10" aria-label="Your menu">
              <Avatar name={user.name} photoUrl={user.photoUrl} size={40} />
              <span className="hidden md:flex flex-col leading-tight min-w-0">
                <span className="text-sm font-bold truncate">{user.name}</span>
                <span className="text-xs text-white/70 truncate">{user.role}</span>
              </span>
              <span className="hidden md:inline ml-auto text-xs text-white/60" aria-hidden>▾</span>
            </summary>
            <div className="absolute right-0 top-full mt-2 md:top-auto md:bottom-full md:left-0 md:right-0 md:mt-0 md:mb-2 z-50 min-w-44 rounded-card border border-white/20 bg-sidebar p-2 shadow-xl">{footer}</div>
          </details>
        ) : null}
      </aside>
      <main className="flex-1 min-w-0 flex flex-col relative pb-28">
        {viewingAs && user ? (
          <div className="bg-amber-soft border-b-2 border-amber-bar px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-bold">
              Viewing as {user.name} ({user.role}) in this tab only. View only: nothing can be changed.
            </span>
            <ModeExit />
          </div>
        ) : null}
        {actingAs && user ? (
          <div className="bg-red-bar text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-bold">
              Acting as {actingAs.forName} ({user.role}) in this tab only. Everything you do is saved and logged as {actingAs.realName}, on behalf of {actingAs.forName}.
            </span>
            <ModeExit dark />
          </div>
        ) : null}
        {/* The one bell: docked into the page header's slot (last on the right, normal flex flow), never floating. */}
        {user ? (
          <BellDock>
            <NotificationBell staffId={user.id} tone={sounds?.tone} ownerTone={sounds?.ownerTone} remindMinutes={sounds?.remindMinutes} />
          </BellDock>
        ) : null}
        {viewingAs ? (
          // View only: every button, box and switch on the page is switched off, so nothing can be changed by accident.
          <fieldset disabled className="view-only flex-1 flex flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8 min-w-0 border-0 m-0">
            {children}
          </fieldset>
        ) : (
          <div className="flex-1 flex flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">{children}</div>
        )}
      </main>
    </div>
  );
}

/** Same bar without a menu, for the login, tablet and setup pages. */
export function PublicShell({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="bg-sidebar text-white flex flex-row md:flex-col items-center gap-3 px-4 py-3 md:px-5 md:py-6 md:w-60 md:shrink-0 md:h-screen md:sticky md:top-0">
        <Logo onDark className="h-11 md:h-15" />
        {note ? <span className="text-xs text-white/70 md:mt-2">{note}</span> : null}
      </aside>
      <main className="flex-1 min-w-0 flex flex-col pb-28">{children}</main>
    </div>
  );
}
