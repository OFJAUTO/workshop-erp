"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MediaCapture } from "./MediaCapture";
import { saveMediaDetails } from "@/lib/upload-client";
import type { WheelState } from "@/lib/media";
import { WHEEL_CONDITIONS, WHEEL_CONDITION_LABELS, cleanWheelConditions } from "@/lib/wheels";

/**
 * One wheel: take the photo, then tap its condition. "None" stands alone; the
 * others can be combined. Nothing is pre-selected.
 */
export function WheelCapture({
  jobId,
  wheel,
  step,
  enabled,
  token,
}: {
  jobId: string;
  wheel: WheelState;
  step: number;
  enabled: boolean;
  token?: string;
}) {
  const router = useRouter();
  const [uploaded, setUploaded] = useState(false);
  const [picked, setPicked] = useState<string[]>(wheel.conditions);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(wheel.conditions.length > 0);
  const [error, setError] = useState<string | null>(null);

  const hasPhoto = wheel.photo || uploaded;

  async function choose(value: string) {
    const next = picked.includes(value)
      ? picked.filter((v) => v !== value)
      : value === "none"
        ? ["none"]
        : cleanWheelConditions([...picked.filter((v) => v !== "none"), value]);
    setPicked(next);
    setSaved(false);
    setError(null);
    if (next.length === 0) return;
    setSaving(true);
    try {
      await saveMediaDetails(jobId, { wheel: { kind: wheel.kind, conditions: next } }, token);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`flex flex-col gap-2 rounded-card border p-3 ${wheel.done || saved ? "border-green" : "border-line"}`}>
      <MediaCapture
        jobId={jobId}
        kind={wheel.kind}
        label={`${step}. ${wheel.label} wheel`}
        done={wheel.photo}
        disabled={!enabled}
        hint={enabled ? "Tap to take the wheel photo" : "Take the wheels in order"}
        token={token}
        onUploaded={() => {
          setUploaded(true);
          // A new photo needs its condition chosen again.
          setPicked([]);
          setSaved(false);
        }}
      />
      {hasPhoto ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Condition (required, tap all that apply)</span>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {WHEEL_CONDITIONS.map((c) => {
              const on = picked.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  disabled={saving}
                  onClick={() => choose(c)}
                  aria-pressed={on}
                  className={`min-h-11 rounded-control border px-2 text-sm font-semibold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}
                >
                  {WHEEL_CONDITION_LABELS[c]}
                </button>
              );
            })}
          </div>
          {error ? <p className="text-sm font-semibold text-red">{error}</p> : saved ? <p className="text-xs font-semibold text-green">Saved</p> : picked.length === 0 ? <p className="text-xs font-semibold text-amber">Choose the condition to finish this wheel.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
