"use client";

import { useEffect, useRef, useState } from "react";

/** How long after the last keystroke a finished number is handed to the rest of the app. */
const SETTLE_MS = 1000;

const fmt = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Digits, one separator (dot or comma) and, for decimals, a leading minus; letters typed by mistake disappear. */
export function cleanNumberText(raw: string, decimal: boolean): string {
  if (!decimal) return raw.replace(/[^\d]/g, "");
  let t = raw.replace(/[^\d.,-]/g, "");
  const negative = t.startsWith("-");
  t = t.replace(/-/g, "");
  let separator = false;
  let out = "";
  for (const ch of t) {
    if (ch === "." || ch === ",") {
      if (separator) continue;
      separator = true;
    }
    out += ch;
  }
  return (negative ? "-" : "") + out;
}

/** A finished number: "2", "2.2", ".5", "2,5", "10.25" or "" (clearing the box). "2." and "-" are not finished yet. */
export const numberComplete = (t: string) => t === "" || /^-?(\d+([.,]\d+)?|[.,]\d+)$/.test(t);

/** The text as the rest of the app reads it: a dot for the comma, "0.5" for ".5", "2" for "2."; "" stays "". */
export function normalizeNumberText(t: string): string {
  let s = t.trim().replace(",", ".");
  if (s === "" || s === "-" || s === "." || s === "-.") return "";
  if (s.startsWith(".")) s = `0${s}`;
  if (s.startsWith("-.")) s = `-0${s.slice(1)}`;
  if (s.endsWith(".")) s = s.slice(0, -1);
  return s;
}

export function parseNumberText(t: string): number | null {
  const s = normalizeNumberText(t);
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * A number or money box that never rewrites what is being typed. While it has the cursor the text stays exactly as
 * typed ("2.", ".5", "2,5"); about a second after typing stops, or when the box is left, the finished number goes to
 * the rest of the app through onChange (dot or comma both accepted). On leaving, the box shows the finished number.
 */
export function NumericInput({ className = "", value, defaultValue, onChange, onBlur, onFocus, onKeyDown, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const decimal = props.inputMode === "decimal";
  const [text, setText] = useState(() => fmt(value ?? defaultValue));
  const [focused, setFocused] = useState(false);
  const [lastSent, setLastSent] = useState(() => normalizeNumberText(fmt(value ?? defaultValue)));
  // A value set by the rest of the app shows at once, but never while the box is being typed in.
  const [seen, setSeen] = useState(value);
  if (!focused && value !== undefined && value !== seen) {
    setSeen(value);
    setText(fmt(value));
    setLastSent(normalizeNumberText(fmt(value)));
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const send = (raw: string) => {
    const norm = normalizeNumberText(raw);
    if (norm === lastSent) return;
    setLastSent(norm);
    if (!onChange) return;
    const target = { value: norm, name: props.name ?? "", id: props.id ?? "" };
    onChange({ target, currentTarget: target, type: "change", preventDefault() {}, stopPropagation() {} } as unknown as React.ChangeEvent<HTMLInputElement>);
  };
  const finish = (el: HTMLInputElement) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const norm = normalizeNumberText(el.value);
    if (el.value !== norm) el.value = norm;
    setText(norm);
    send(norm);
  };

  return (
    <input
      className={className}
      spellCheck={false}
      {...props}
      value={text}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onChange={(e) => {
        const c = cleanNumberText(e.target.value, decimal);
        setText(c);
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        if (numberComplete(c)) timer.current = setTimeout(() => { timer.current = null; send(c); }, SETTLE_MS);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget);
        onKeyDown?.(e);
      }}
      onBlur={(e) => {
        finish(e.currentTarget);
        setFocused(false);
        onBlur?.(e);
      }}
    />
  );
}
