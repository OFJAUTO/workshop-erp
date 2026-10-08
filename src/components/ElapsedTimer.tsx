"use client";

import { useEffect, useState } from "react";

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** A running clock since a moment. Working time (the figure that counts) comes from the server alongside it. */
export function ElapsedTimer({ since, stoppedAt, className = "" }: { since: string; stoppedAt?: string | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (stoppedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stoppedAt]);
  const end = stoppedAt ? Date.parse(stoppedAt) : now;
  return <span className={`font-mono tabular-nums ${className}`}>{fmt(end - Date.parse(since))}</span>;
}
