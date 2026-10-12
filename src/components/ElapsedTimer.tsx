"use client";

import { useSyncExternalStore } from "react";

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// One clock for every timer on the page: a tick a second, and a value that only changes on a tick (React asks for it often).
let lastTick = Date.now();
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!interval) interval = setInterval(() => { lastTick = Date.now(); for (const l of listeners) l(); }, 1000);
  return () => {
    listeners.delete(cb);
    if (!listeners.size && interval) { clearInterval(interval); interval = null; }
  };
}
const getNow = () => lastTick;
// On the server, and during hydration, the clock has no value: the same placeholder on both sides, never a mismatch.
const getServerNow = () => 0;

/** A running clock since a moment. Working time (the figure that counts) comes from the server alongside it. */
export function ElapsedTimer({ since, stoppedAt, className = "" }: { since: string; stoppedAt?: string | null; className?: string }) {
  const now = useSyncExternalStore(subscribe, getNow, getServerNow);
  const end = stoppedAt ? Date.parse(stoppedAt) : now;
  return <span className={`font-mono tabular-nums ${className}`}>{!stoppedAt && now === 0 ? "–:––" : fmt(end - Date.parse(since))}</span>;
}
