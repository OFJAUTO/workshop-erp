"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui";
import type { TechnicianLoad } from "@/lib/technician-load";

const RING: Record<TechnicianLoad["status"], string> = { free: "ring-green", paused: "ring-amber-bar", working: "ring-red-bar" };
const BAR = (p: number) => (p < 60 ? "bg-green" : p <= 90 ? "bg-amber-bar" : "bg-red-bar");

/**
 * One thin line per technician, freest first: tick box, photo with a status ring (green free, amber
 * paused, red working), name and what he is doing now, his cars as plate tags, and the week's load
 * bar. Ticking a busy technician asks once; it never blocks. Without tick boxes it is the Workshop
 * load list.
 */
export function TechnicianPicker({ technicians, name = "technician", checked = [], pick = true, hint }: { technicians: TechnicianLoad[]; name?: string; checked?: string[]; pick?: boolean; hint?: string | null }) {
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(checked.map((c) => [c, true])));
  const [ask, setAsk] = useState<string | null>(null);
  const toggle = (t: TechnicianLoad) => {
    if (on[t.id]) { setOn((o) => ({ ...o, [t.id]: false })); return; }
    if (t.status !== "free" && ask !== t.id) { setAsk(t.id); return; }
    setAsk(null);
    setOn((o) => ({ ...o, [t.id]: true }));
  };
  return (
    <div className="flex flex-col gap-1">
      <ul className="divide-y divide-line rounded-control border border-line">
        {technicians.map((t) => (
          <li key={t.id} className="flex flex-col">
            <div className={`flex items-center gap-3 px-2 py-1.5 ${on[t.id] ? "bg-chip" : ""}`}>
              {pick ? <input type="checkbox" name={name} value={t.id} checked={!!on[t.id]} onChange={() => toggle(t)} className="h-6 w-6 accent-ink shrink-0" aria-label={`Assign ${t.display_name}`} /> : null}
              <span className={`shrink-0 rounded-full ring-[3px] ${RING[t.status]}`}><Avatar name={t.display_name} photoUrl={t.photoUrl} size={36} /></span>
              <span className="flex flex-col min-w-0 w-40 shrink-0"><span className="font-bold truncate">{t.display_name}</span><span className="text-xs text-muted truncate">{t.now}</span></span>
              <span className="flex flex-wrap gap-1 flex-1 min-w-0">
                {t.cars.map((c) => <span key={c.jobId} className={`rounded-control border px-1.5 py-0.5 text-[11px] font-bold ${c.running ? "border-red-bar text-red" : "border-line text-muted"}`}>{c.plate}</span>)}
              </span>
              <span className="flex flex-col items-end w-36 shrink-0 gap-0.5">
                <span className="text-[11px] font-semibold text-muted">{t.loadHours} of {t.weekHours} h this week</span>
                <span className="h-1.5 w-full rounded-full bg-track overflow-hidden"><span className={`block h-full ${BAR(t.percent)}`} style={{ width: `${Math.min(100, t.percent)}%` }} /></span>
              </span>
            </div>
            {pick && ask === t.id ? (
              <div className="flex flex-wrap items-center gap-2 bg-amber-soft px-3 py-2 text-xs">
                <span className="font-semibold">{t.display_name} is {t.status === "working" ? "working on another car" : "already on a car"}. Assign anyway?</span>
                <button type="button" onClick={() => toggle(t)} className="min-h-9 rounded-control bg-ink px-3 font-bold text-white">Yes, assign</button>
                <button type="button" onClick={() => setAsk(null)} className="min-h-9 rounded-control border border-line px-3 font-semibold">No</button>
              </div>
            ) : null}
          </li>
        ))}
        {technicians.length === 0 ? <li className="px-3 py-2 text-sm text-muted">No technicians in this department yet. Set departments on the Team page.</li> : null}
      </ul>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}
