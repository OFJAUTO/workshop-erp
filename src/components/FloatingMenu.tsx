"use client";

import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A pop-up menu drawn on top of everything (through a portal on the page body), so no table, card or scrolling box
 * ever clips it. It sits under its button, or above the button when there is no room below. Tapping outside or
 * pressing Escape closes it. The `data-*` attributes go on the menu itself (the quotation editor's outside-tap guard
 * looks for one).
 */
export function FloatingMenu({ anchor, onClose, width = 256, label, children, ...rest }: { anchor: HTMLElement | null; onClose: () => void; width?: number; label?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    // Below the button, else above it; a menu taller than either side (a phone, 44 px rows) takes the larger side and
    // scrolls inside itself, or the whole screen when neither side has room - never a bottom that cannot be reached.
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const full = ref.current?.scrollHeight ?? 320;
      // Both sides are counted inside the window (a button scrolled off the screen leaves no room on that side).
      const below = Math.min(window.innerHeight, window.innerHeight - r.bottom) - 12;
      const above = Math.min(window.innerHeight, r.top) - 12;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
      // Whatever the button does (a tablet turned with the menu open moves it off the screen), the menu stays inside the window.
      const set = (top: number, up: boolean, maxHeight: number) => {
        const h = Math.min(full, maxHeight);
        setPos({ top: Math.max(8, Math.min(top, window.innerHeight - h - 8)), left, up, maxHeight });
      };
      if (full <= below) return set(r.bottom + 4, false, below);
      if (full <= above) return set(r.top - full - 4, true, above);
      const side = Math.max(below, above);
      if (side < 200) return set(8, false, window.innerHeight - 16);
      if (below >= above) return set(r.bottom + 4, false, below);
      return set(8, true, above - 4);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, width]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} data-menu-backdrop />
      <div ref={ref} role="menu" aria-label={label} className="fixed z-[61] flex flex-col overflow-y-auto rounded-card border border-line bg-white p-1 text-sm shadow-xl" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, maxHeight: pos?.maxHeight }} data-floating-menu data-menu-up={pos?.up ? "1" : "0"} {...rest}>
        {children}
      </div>
    </>,
    document.body,
  );
}
