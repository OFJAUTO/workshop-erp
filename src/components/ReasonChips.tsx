"use client";

import { useState } from "react";
import { Input, Textarea } from "@/components/ui";

/**
 * One-tap reasons: a row of chips above a box. Tapping a chip writes it into the box (several allowed, joined with
 * "; "), turns light green with a tick, and tapping it again takes it out. Typing in the box is always possible.
 * Works inside any form: the box carries the name.
 */
export function ReasonChips({ name, options, defaultValue = "", placeholder, required, rows, label, className = "", textCase, onValue, id, inputClassName = "", disabled }: { name: string; options: readonly string[]; defaultValue?: string; placeholder?: string; required?: boolean; /** A box of several lines instead of one. */ rows?: number; label?: string; className?: string; textCase?: "sentence" | "title" | "upper"; onValue?: (v: string) => void; id?: string; inputClassName?: string; disabled?: boolean }) {
  const [text, setText] = useState(defaultValue);
  const parts = text.split(";").map((s) => s.trim()).filter(Boolean);
  const selected = (o: string) => parts.some((p) => p.toLowerCase() === o.toLowerCase());
  const set = (v: string) => {
    setText(v);
    onValue?.(v);
  };
  const tap = (o: string) => {
    if (disabled) return;
    const next = selected(o) ? parts.filter((p) => p.toLowerCase() !== o.toLowerCase()) : [...parts, o];
    set(next.join("; "));
  };
  const boxProps = { id, name, value: text, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(e.target.value), placeholder, required, disabled, textCase, className: inputClassName };
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label ? <span className="text-xs font-semibold text-muted">{label}</span> : null}
      {options.length ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <button key={o} type="button" disabled={disabled} onClick={() => tap(o)} aria-pressed={selected(o)} className={`min-h-9 rounded-control border px-2.5 text-xs font-semibold text-left ${selected(o) ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>
              {selected(o) ? "✓ " : ""}{o}
            </button>
          ))}
        </div>
      ) : null}
      {rows && rows > 1 ? <Textarea {...boxProps} rows={rows} className={`min-h-16 ${inputClassName}`} /> : <Input {...boxProps} />}
    </div>
  );
}
