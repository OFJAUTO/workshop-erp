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
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 320;
      const up = window.innerHeight - r.bottom < h + 16 && r.top > h + 16;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
      setPos({ top: up ? Math.max(8, r.top - h - 4) : r.bottom + 4, left, up });
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
      <div ref={ref} role="menu" aria-label={label} className="fixed z-[61] flex flex-col rounded-card border border-line bg-white p-1 text-sm shadow-xl" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }} data-floating-menu data-menu-up={pos?.up ? "1" : "0"} {...rest}>
        {children}
      </div>
    </>,
    document.body,
  );
}
