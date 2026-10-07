"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SearchOption = { id: string; label: string };

/**
 * A text box you type into, with matching choices underneath. Picks an existing
 * entry, or keeps the typed text as a new entry when allowed.
 * Submits two fields: `<name>_id` (the chosen id, or "__new__") and `<name>_text`.
 */
export function SearchSelect({
  name,
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  allowNew = true,
  required = true,
  warning,
}: {
  name: string;
  label: string;
  options: SearchOption[];
  value: { id: string; text: string };
  onChange: (v: { id: string; text: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  allowNew?: boolean;
  required?: boolean;
  warning?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const q = value.text.trim().toLowerCase();
    const list = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    return list.slice(0, 12);
  }, [options, value.text]);
  const exact = options.find((o) => o.label.toLowerCase() === value.text.trim().toLowerCase());
  const isNew = !exact && value.text.trim().length > 0;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(o: SearchOption) {
    onChange({ id: o.id, text: o.label });
    setOpen(false);
  }

  return (
    <div ref={box} className="relative flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <input
        type="text"
        value={value.text}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const text = e.target.value;
          const hit = options.find((o) => o.label.toLowerCase() === text.trim().toLowerCase());
          onChange({ id: hit ? hit.id : allowNew && text.trim() ? "__new__" : "", text });
          setOpen(true);
        }}
        className="min-h-11 w-full rounded-control border border-line-strong bg-white px-3.5 text-[15px] outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 disabled:bg-canvas disabled:text-muted"
      />
      <input type="hidden" name={`${name}_id`} value={value.id} />
      <input type="hidden" name={`${name}_text`} value={value.text} />
      {open && !disabled && (matches.length > 0 || isNew) ? (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-control border border-line-strong bg-white shadow-lg">
          {matches.map((o) => (
            <li key={o.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)} className={`w-full px-3.5 py-2.5 text-left text-sm hover:bg-chip ${o.id === value.id ? "font-bold" : ""}`}>
                {o.label}
              </button>
            </li>
          ))}
          {isNew && allowNew ? (
            <li className="px-3.5 py-2.5 text-xs text-muted border-t border-line">
              &quot;{value.text.trim()}&quot; is new. It will be added and put on the review list.
            </li>
          ) : null}
        </ul>
      ) : null}
      {warning ? <span className="text-xs font-semibold text-amber">{warning}</span> : null}
      {isNew && allowNew && !open ? <span className="text-xs text-muted">New entry, will be added for review.</span> : null}
    </div>
  );
}
