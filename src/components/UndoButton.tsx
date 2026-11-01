"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { undoLabel, undoSecondsLeft } from "@/lib/money-undo";

const noop = () => () => {};

/**
 * "Payment recorded · Undo (9:58)" (1 November 2026, B3): the bar after a confirmed money action. It counts down the
 * undo window (Settings, 10 minutes) and goes away when it is over; until then the same person or the owner can undo.
 * Either a form action (a server action bound to the record) or a click handler.
 */
export function UndoButton({ at, minutes, done, action, onUndo, busy = false }: { at: string; minutes: number; done: string; action?: (formData: FormData) => void | Promise<void>; onUndo?: () => void; busy?: boolean }) {
  // Drawn in the browser only: a countdown made on the server would never match the browser's first draw.
  const inBrowser = useSyncExternalStore(noop, () => true, () => false);
  const [left, setLeft] = useState(() => undoSecondsLeft(at, minutes));
  useEffect(() => {
    const t = setInterval(() => setLeft(undoSecondsLeft(at, minutes)), 1000);
    return () => clearInterval(t);
  }, [at, minutes]);
  if (!inBrowser || left <= 0) return null;
  const button = <button type={action ? "submit" : "button"} onClick={action ? undefined : onUndo} disabled={busy} className="min-h-11 rounded-control border-2 border-ink bg-white px-4 text-sm font-extrabold text-ink disabled:opacity-60" data-undo-money>{busy ? "Undoing…" : undoLabel(left)}</button>;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-control bg-ink px-3 py-2 text-white" data-undo-bar>
      <span className="text-sm font-bold">{done}</span>
      {action ? <form action={action}>{button}</form> : button}
    </div>
  );
}
