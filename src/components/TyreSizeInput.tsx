"use client";

import { useEffect, useRef, useState } from "react";
import { TYRE_SIZE_LIMITS, tyreSizeComplete, tyreSizeFromParts, tyreSizeParts, type TyreSizeParts } from "@/lib/inspection";

const FIELDS = [
  { key: "width", digits: 3, placeholder: "275", label: "width" },
  { key: "profile", digits: 2, placeholder: "40", label: "profile" },
  { key: "rim", digits: 2, placeholder: "20", label: "rim" },
] as const;

/**
 * A tyre size as three numeric boxes: [width] / [profile] R [rim]. The cursor moves on by itself when a box is
 * full, a number outside the sensible range turns the box red, and the value is saved as "275/40 R20".
 * `sameAs` offers one tap to copy the front size; `suggestion` offers the size other cars of this model had.
 */
export function TyreSizeInput({
  id,
  label,
  value,
  onChange,
  disabled = false,
  sameAs = null,
  suggestion = null,
  problem = false,
}: {
  id?: string;
  label: string;
  value: string;
  /** Called with the text and whether all three boxes are full. */
  onChange: (text: string, complete: boolean) => void;
  disabled?: boolean;
  sameAs?: { label: string; value: string } | null;
  suggestion?: string | null;
  problem?: boolean;
}) {
  const [parts, setParts] = useState<TyreSizeParts>(() => tyreSizeParts(value));
  const last = useRef(value);
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setParts(tyreSizeParts(value));
    }
  }, [value]);

  function set(next: TyreSizeParts) {
    setParts(next);
    const text = tyreSizeFromParts(next);
    last.current = text;
    onChange(text, tyreSizeComplete(text));
  }
  function type(i: number, raw: string) {
    const f = FIELDS[i];
    const digits = raw.replace(/\D/g, "").slice(0, f.digits);
    set({ ...parts, [f.key]: digits });
    if (digits.length === f.digits && i < FIELDS.length - 1) refs[i + 1].current?.focus();
  }
  const outOfRange = (i: number) => {
    const f = FIELDS[i];
    const v = parts[f.key];
    if (v.length < f.digits) return false;
    const [lo, hi] = TYRE_SIZE_LIMITS[f.key];
    return Number(v) < lo || Number(v) > hi;
  };
  const anyBad = FIELDS.some((_, i) => outOfRange(i));
  const complete = tyreSizeComplete(tyreSizeFromParts(parts));
  const box = (bad: boolean) =>
    `min-h-11 w-16 rounded-control border bg-white text-center text-base font-bold outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 disabled:bg-canvas disabled:text-muted ${bad ? "border-red-bar" : "border-line-strong"}`;

  return (
    <div id={id} className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {FIELDS.map((f, i) => (
          <span key={f.key} className="inline-flex items-center gap-1.5">
            {i === 1 ? <span className="text-lg font-bold text-muted">/</span> : i === 2 ? <span className="text-base font-bold text-muted">R</span> : null}
            <input
              ref={refs[i]}
              value={parts[f.key]}
              onChange={(e) => type(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !parts[f.key] && i > 0) refs[i - 1].current?.focus();
              }}
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder={f.placeholder}
              aria-label={`${label} ${f.label}`}
              disabled={disabled}
              spellCheck={false}
              className={box(outOfRange(i) || (problem && !complete))}
            />
          </span>
        ))}
        {sameAs && !disabled ? (
          <button type="button" onClick={() => set(tyreSizeParts(sameAs.value))} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-xs font-bold whitespace-nowrap">
            {sameAs.label}
          </button>
        ) : null}
      </div>
      {anyBad ? (
        <span className="text-xs font-bold text-red">
          Width {TYRE_SIZE_LIMITS.width[0]} to {TYRE_SIZE_LIMITS.width[1]}, profile {TYRE_SIZE_LIMITS.profile[0]} to {TYRE_SIZE_LIMITS.profile[1]}, rim {TYRE_SIZE_LIMITS.rim[0]} to {TYRE_SIZE_LIMITS.rim[1]}.
        </span>
      ) : null}
      {suggestion && !complete && !disabled && tyreSizeComplete(suggestion) ? (
        <button type="button" onClick={() => set(tyreSizeParts(suggestion))} className="self-start min-h-9 rounded-control border border-dashed border-line-strong bg-white px-2.5 text-xs font-semibold">
          Usually {suggestion} on this model · tap to use
        </button>
      ) : null}
    </div>
  );
}
