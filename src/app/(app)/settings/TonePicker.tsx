"use client";

import { useState } from "react";
import { TONES, playTone, type ToneId } from "@/lib/tones";

/** The sound picker in Settings: a play button beside each tone; the chosen one is saved with the form. */
export function TonePicker({ name, initial }: { name: string; initial: string }) {
  const [value, setValue] = useState<ToneId>(TONES.some((t) => t.id === initial) ? (initial as ToneId) : "marimba");
  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={name} value={value} />
      {TONES.map((t) => (
        <div key={t.id} className="flex items-center gap-2">
          <button type="button" onClick={() => setValue(t.id)} aria-pressed={value === t.id} className={`flex-1 min-h-11 rounded-control border-2 px-3 text-left text-sm font-bold ${value === t.id ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{t.label}</button>
          <button type="button" onClick={() => playTone(t.id, 0.6)} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-sm font-bold" aria-label={`Play ${t.label}`}>▶ Play</button>
        </div>
      ))}
    </div>
  );
}
