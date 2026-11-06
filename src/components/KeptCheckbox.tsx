"use client";

import { useEffect, useRef, type InputHTMLAttributes } from "react";

/**
 * A tick box whose ticked state React controls, kept through the form reset React 19 does after every server action
 * (6 November 2026). React sets the box's default only on the first render, so after a refused save "No number plate"
 * snapped back to ticked while the plate was still typed below, and the next save sent the wrong answer. Every render
 * here also makes the current state the default, so a reset keeps it. The checkbox twin of `KeptSelect`.
 */
export function KeptCheckbox(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { checked: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const { checked } = props;
  useEffect(() => {
    if (ref.current) ref.current.defaultChecked = checked;
  });
  return <input ref={ref} type="checkbox" {...props} />;
}
