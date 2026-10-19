"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The sticker sheet: a grid of stickers, each with a tablet-size tick box on its RIGHT (name and
 * quantity beside it), all ticked by default. Select all / Clear all and ONE "Print selected (N)"
 * button at the top print every ticked sticker in one job, one page each, in order. The print
 * output is the stickers alone: the bar, the tick boxes and the grid chrome all disappear.
 */
export function StickerSheet({ items, printer, info, auto = false, extra, children }: {
  items: { key: string; name: string; qty: string }[];
  printer: string;
  info: string;
  auto?: boolean;
  extra?: ReactNode;
  children: ReactNode[];
}) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const n = items.length - off.size;
  useEffect(() => {
    if (!auto || !items.length) return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [auto, items.length]);
  const kids = Array.isArray(children) ? children : [children];
  const toggle = (key: string) => setOff((o) => { const s = new Set(o); if (s.has(key)) s.delete(key); else s.add(key); return s; });
  return (
    <>
      <div className="bar">
        <span>{info}</span>
        <button type="button" onClick={() => setOff(new Set())} data-select-all-stickers>Select all</button>
        <button type="button" onClick={() => setOff(new Set(items.map((i) => i.key)))} data-clear-all-stickers>Clear all</button>
        <button type="button" className="print-btn" disabled={!n} onClick={() => window.print()} data-print-selected>
          Print selected ({n}) · {printer}
        </button>
        {extra}
      </div>
      <div className="sheet">
        {items.map((it, i) => {
          const on = !off.has(it.key);
          return (
            <div key={it.key} className={`one${on ? "" : " off"}`} data-sticker-one data-on={on ? "1" : "0"}>
              <div className="art">{kids[i]}</div>
              <button type="button" className="pick" aria-pressed={on} onClick={() => toggle(it.key)}>
                <span className="meta"><strong>{it.name}</strong><br />{it.qty}</span>
                <span className={`tick${on ? " tick-on" : ""}`}>✓</span>
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
