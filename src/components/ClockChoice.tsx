"use client";

import { useState } from "react";
import { PAUSE_REASONS, type PauseReason } from "@/lib/clock-choice";

export type ClockState = { onThisCar: boolean; onOtherCar: string | null; pausedHere: string | null };

/**
 * CLOCKING: START / PAUSE / STOP (10 November 2026, Section 7). THE clock choice shown after the PIN on a shared tablet:
 * nothing changes until a button is pressed. Start clocks on this car (another car is paused by itself: "moved to
 * another car"); Pause asks why with one tap; Stop = "my part is done". After a pause (the break) Start reads "Back on
 * this car".
 */
export function ClockChoice({ name, car, state, busy, onChoose, onBack }: { name: string; car: string; state: ClockState; busy: boolean; onChoose: (action: "start" | "pause" | "stop", reason?: PauseReason) => void; onBack: () => void }) {
  const [asking, setAsking] = useState(false);
  const big = "min-h-20 rounded-card border-2 px-6 text-xl font-extrabold disabled:opacity-50";
  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-4" data-clock-choice={state.onThisCar ? "on" : "off"}>
      <p className="text-center text-base">
        <span className="font-bold">{name}</span> · {car}
        {state.onThisCar ? <span className="block font-semibold text-green-text" data-clock-on-here>Clocked on this car now</span> : null}
        {state.onOtherCar ? <span className="block font-semibold text-amber-text" data-clock-on-other>On {state.onOtherCar} now: Start pauses it (moved to another car)</span> : null}
        {state.pausedHere ? <span className="block font-semibold text-amber-text" data-clock-paused-here>Paused ({state.pausedHere.toLowerCase()}). Back on this car?</span> : null}
      </p>
      {asking ? (
        <div className="flex w-full flex-col gap-2" data-clock-reasons>
          <p className="text-center text-base font-semibold">Why do you pause? Tap one.</p>
          <div className="grid grid-cols-2 gap-3">
            {PAUSE_REASONS.filter((r) => r !== "Moved to another car").map((r) => (
              <button key={r} type="button" disabled={busy} onClick={() => onChoose("pause", r)} className="min-h-16 rounded-card border-2 border-line-strong bg-white px-4 text-lg font-bold" data-clock-reason={r}>{r}</button>
            ))}
          </div>
          <button type="button" onClick={() => setAsking(false)} className="min-h-12 rounded-control border border-line-strong bg-white px-5 text-base font-bold">Back</button>
        </div>
      ) : (
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          <button type="button" disabled={busy || state.onThisCar} onClick={() => onChoose("start")} className={`${big} border-green bg-green-soft text-green-text`} data-clock-start>{state.pausedHere ? "Back on this car" : "Start"}</button>
          <button type="button" disabled={busy || !state.onThisCar} onClick={() => setAsking(true)} className={`${big} border-amber-bar bg-amber-soft text-amber-text`} data-clock-pause>Pause</button>
          <button type="button" disabled={busy || !state.onThisCar} onClick={() => onChoose("stop")} className={`${big} border-ink bg-white`} data-clock-stop>Stop · my part is done</button>
        </div>
      )}
      {!asking ? <button type="button" onClick={onBack} className="min-h-12 rounded-control border border-line-strong bg-white px-5 text-base font-bold" data-clock-back>Back</button> : null}
    </div>
  );
}
