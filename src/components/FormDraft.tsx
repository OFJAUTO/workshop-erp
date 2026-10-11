"use client";

import { useEffect, useRef } from "react";

const SKIP_TYPES = new Set(["hidden", "file", "password", "submit", "button", "reset", "image"]);

function setNative(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

/**
 * A draft for a long form: what is typed or tapped is kept in this browser and put back if the page
 * is closed, refreshed or the tablet goes to sleep before Save. Only fields still at their starting
 * value are filled in, so nothing saved on the server is overwritten. The draft is cleared on submit
 * and after a day. Put it anywhere inside the form.
 */
export function FormDraft({ draftKey, skip = [], ttlHours = 24 }: { draftKey: string; /** Field names another component restores itself. */ skip?: string[]; ttlHours?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const key = `erp-draft-${draftKey}`;
    const skipped = new Set(skip);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const d = JSON.parse(raw) as { t: number; v: Record<string, string | string[]> };
        if (Date.now() - d.t < ttlHours * 3600000) {
          for (const [name, val] of Object.entries(d.v)) {
            if (skipped.has(name)) continue;
            const els = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`[name="${name.replace(/"/g, '\\"')}"]`));
            for (const el of els) {
              if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
                if (el.checked !== el.defaultChecked) continue;
                const want = Array.isArray(val) ? val.includes(el.value) : val === el.value || (el.type === "checkbox" && val === "on");
                if (el.checked !== want) {
                  el.checked = want;
                  el.dispatchEvent(new Event("change", { bubbles: true }));
                }
              } else if (!(el instanceof HTMLInputElement && SKIP_TYPES.has(el.type))) {
                if (el.value !== el.defaultValue) continue;
                const v = Array.isArray(val) ? (val[0] ?? "") : val;
                if (v && el.value !== v) {
                  setNative(el, v);
                  el.dispatchEvent(new Event("input", { bubbles: true }));
                }
              }
            }
          }
        } else localStorage.removeItem(key);
      }
    } catch {}
    let timer: ReturnType<typeof setTimeout> | null = null;
    const saveDraft = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        try {
          const v: Record<string, string | string[]> = {};
          const fd = new FormData(form);
          for (const [k, val] of fd.entries()) {
            if (typeof val !== "string") continue;
            const el = form.elements.namedItem(k);
            if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type)) continue;
            const cur = v[k];
            v[k] = cur === undefined ? val : Array.isArray(cur) ? [...cur, val] : [cur, val];
          }
          localStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
        } catch {}
      }, 300);
    };
    const clear = () => {
      try {
        localStorage.removeItem(key);
      } catch {}
    };
    form.addEventListener("input", saveDraft);
    form.addEventListener("change", saveDraft);
    form.addEventListener("submit", clear);
    return () => {
      form.removeEventListener("input", saveDraft);
      form.removeEventListener("change", saveDraft);
      form.removeEventListener("submit", clear);
      if (timer) clearTimeout(timer);
    };
  }, [draftKey, skip, ttlHours]);
  return <span ref={ref} hidden />;
}

/** Reads a draft's saved values (for components that keep their own state). */
export function readDraft(draftKey: string, ttlHours = 24): Record<string, string | string[]> | null {
  try {
    const raw = localStorage.getItem(`erp-draft-${draftKey}`);
    if (!raw) return null;
    const d = JSON.parse(raw) as { t: number; v: Record<string, string | string[]> };
    return Date.now() - d.t < ttlHours * 3600000 ? d.v : null;
  } catch {
    return null;
  }
}
