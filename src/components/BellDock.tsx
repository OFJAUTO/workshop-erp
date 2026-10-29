"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

/**
 * Docks the ONE notification bell into the page header's slot (<span id="header-bell-slot">), so it sits
 * last on the right of the same flex row as the title, search and buttons - normal layout, never floating,
 * never on top of anything. Every PageHeader and HomeHeader carries the slot; a page without one gets the
 * bell in its own right-aligned row at the top of the content, still in normal flow.
 */
export function BellDock({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [target, setTarget] = useState<Element | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 68.74rem)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    let tries = 0;
    let raf = 0;
    const find = () => {
      // Below 1,100 px the bell lives in the black top bar (29 October 2026); above it, last in the page header's row.
      const el = document.getElementById(narrow ? "topbar-bell-slot" : "header-bell-slot");
      if (el) {
        setTarget(el);
        return;
      }
      setTarget(null);
      // The page may still be streaming in: look again for a moment, then settle on the fallback row.
      if (tries++ < 40) raf = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, [pathname, narrow]);
  if (target) return createPortal(children, target);
  return <div className="flex justify-end px-4 pt-4 sm:px-6 lg:px-8" data-bell-fallback>{children}</div>;
}
