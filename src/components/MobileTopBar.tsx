"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "./Logo";
import { SidebarNav, type NavItem } from "./SidebarNav";
import { TopSearch } from "./TopSearch";

/**
 * The menu on a screen narrower than about 1,100 px (a tablet held upright, a phone; 29 October 2026, batch
 * section 2): the sidebar folds into a black top bar with ☰, the OFJ logo, the search and the bell. ☰ slides the
 * menu over the page; ✕, a tap outside, Escape or the phone's back button close it, and it closes after a page is
 * picked. Wider screens keep the sidebar (the Shell hides this bar there).
 */
export function MobileTopBar({ nav, account }: { nav: NavItem[]; /** The person's name and the Sign out form, at the bottom of the menu. */ account?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const pushed = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    // Opening added one history step (so the back button closes the menu); closing by ✕ takes it back off.
    if (pushed.current) {
      pushed.current = false;
      if (window.history.state?.erpMenu) window.history.back();
    }
  }, []);

  // A page was picked: the menu closes (the history step was the page's own navigation, so nothing to take back).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (open) setOpen(false);
  }
  useEffect(() => {
    if (!open) pushed.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPop = () => {
      pushed.current = false;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  function openMenu() {
    if (!pushed.current) {
      window.history.pushState({ ...(window.history.state ?? {}), erpMenu: true }, "");
      pushed.current = true;
    }
    setOpen(true);
  }

  return (
    <>
      <header className="sticky top-0 z-40 flex min-h-16 items-center gap-2 bg-sidebar px-2 py-2 text-white nav:hidden" data-top-bar>
        <button type="button" onClick={openMenu} aria-label="Open the menu" aria-expanded={open} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-2xl hover:bg-white/10" data-menu-open>
          ☰
        </button>
        <Link href="/home" aria-label="Home" className="shrink-0">
          <Logo onDark className="h-9" />
        </Link>
        <div className="min-w-0 flex-1 [&_input]:min-h-11" data-top-search>
          <TopSearch />
        </div>
        <span id="topbar-bell-slot" className="inline-flex shrink-0 items-center" />
      </header>
      {open ? (
        <div className="fixed inset-0 z-[70] nav:hidden" data-menu-drawer>
          <div className="absolute inset-0 bg-black/50" onClick={close} data-menu-backdrop />
          <nav className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col gap-4 overflow-y-auto bg-sidebar px-4 py-4 text-white shadow-2xl" aria-label="Menu">
            <div className="flex items-center justify-between gap-2">
              <Logo onDark className="h-10" />
              <button type="button" onClick={close} aria-label="Close the menu" className="inline-flex h-11 w-11 items-center justify-center rounded-control text-2xl hover:bg-white/10" data-menu-close>
                ✕
              </button>
            </div>
            <div className="[&_nav]:flex-col">{nav.length ? <SidebarNav items={nav} vertical /> : null}</div>
            {account ? <div className="mt-auto border-t border-white/15 pt-4">{account}</div> : null}
          </nav>
        </div>
      ) : null}
    </>
  );
}
