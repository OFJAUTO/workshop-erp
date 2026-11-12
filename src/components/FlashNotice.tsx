"use client";

import { useEffect, useState } from "react";
import { Notice } from "@/components/ui";

/**
 * THE short success message (13 November 2026, Section 1f): shows what just happened, then goes away by itself after
 * a few seconds instead of staying on the page. Errors never use this (they stay until the person acts).
 */
export function FlashNotice({ children, ms = 7000 }: { children: string; ms?: number }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const hide = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(hide);
  }, [ms]);
  if (!shown) return null;
  return <div data-flash-notice><Notice tone="success">{children}</Notice></div>;
}
