"use client";

import { useEffect, useRef, type SelectHTMLAttributes } from "react";

/**
 * A drop-down whose value React controls, kept through the form reset React 19 does after every server action.
 * React marks the chosen option as the default only on the first render, so a car picked by hand went back to
 * "Choose the car…" after the server's first answer while the screen still believed it was chosen, and the next
 * submit was refused behind any open window (the dead "Create a new one anyway" of 30 October 2026). Every change
 * here also makes the chosen option the default, so a reset keeps it. Used by `Select` whenever it gets a `value`.
 */
export function KeptSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const ref = useRef<HTMLSelectElement>(null);
  const { value } = props;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chosen = new Set((Array.isArray(value) ? value : [value]).map((v) => String(v ?? "")));
    for (const o of Array.from(el.options)) o.defaultSelected = chosen.has(o.value);
  });
  return <select ref={ref} {...props} />;
}
