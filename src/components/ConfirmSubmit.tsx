"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui";

type Live = { label?: string; field: string; /** Shown when the field is empty. */ empty?: string; /** A file or a stored path: "proof attached ✓" / "no proof". */ proof?: boolean };

/**
 * THE confirmation before a money action (1 November 2026, B3): paid to supplier, a payment, a refund, a credit note,
 * a card settlement, an LPO approval, a tax invoice. One tap opens a window that says exactly what will happen - the
 * fixed words plus what is typed in the form right now ("Card · ref 123456 · proof attached ✓") - with Cancel and a
 * button that names the action ("Yes, record payment"), never just OK. The form is sent only from that button.
 */
export function ConfirmSubmit({ label, title, lines, live = [], confirmLabel, name, value, tone = "primary", size = "lg", disabled = false, className, hook = "money", attrs }: { label: string; title: string; lines: string[]; live?: Live[]; confirmLabel: string; name?: string; value?: string; tone?: "primary" | "secondary" | "danger" | "ghost"; size?: "md" | "lg"; disabled?: boolean; className?: string; hook?: string; /** data-* hooks kept on the opening button. */ attrs?: Record<string, string> }) {
  const btn = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState<string[]>([]);
  const read = (): string[] => {
    const form = btn.current?.closest("form");
    if (!form) return [];
    return live
      .map((l) => {
        const el = form.elements.namedItem(l.field) as (HTMLInputElement & HTMLSelectElement) | RadioNodeList | null;
        let v = "";
        if (el && "length" in el && !(el instanceof HTMLSelectElement)) {
          for (const node of Array.from(el as RadioNodeList)) if ((node as HTMLInputElement).checked) v = (node as HTMLInputElement).closest("label")?.textContent?.trim() || (node as HTMLInputElement).value;
        } else if (el instanceof HTMLSelectElement) v = el.selectedOptions[0]?.textContent?.trim() ?? el.value;
        else if (el && (el as HTMLInputElement).type === "file") v = (el as HTMLInputElement).files?.length ? "file" : "";
        else if (el) v = String((el as HTMLInputElement).value ?? "").trim();
        if (l.proof) return v ? "proof attached ✓" : (l.empty ?? "no proof attached");
        if (!v) return l.empty ?? "";
        return l.label ? `${l.label} ${v}` : v;
      })
      .filter(Boolean);
  };
  const submit = () => {
    const form = btn.current?.closest("form");
    setOpen(false);
    if (!form) return;
    if (name) {
      let hidden = form.querySelector<HTMLInputElement>(`input[type="hidden"][data-confirm-carry="${name}"]`);
      if (!hidden) {
        hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = name;
        hidden.setAttribute("data-confirm-carry", name);
        form.appendChild(hidden);
      }
      hidden.value = value ?? "";
    }
    form.requestSubmit();
  };
  return (
    <>
      <span ref={btn} className="contents">
        <Button type="button" size={size} tone={tone} disabled={disabled} className={className} onClick={() => { const form = btn.current?.closest("form"); if (form && !form.reportValidity()) return; setWords(read()); setOpen(true); }} data-confirm-open={hook} {...attrs}>
          {label}
        </Button>
      </span>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={() => setOpen(false)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} data-confirm-money={hook}>
          <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card bg-white p-5 flex flex-col gap-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-extrabold">{title}</h2>
            <p className="text-sm font-semibold leading-relaxed" data-confirm-text>{[...lines, ...words].join(" · ")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="lg" tone="secondary" onClick={() => setOpen(false)} data-confirm-cancel autoFocus>Cancel</Button>
              <Button type="button" size="lg" tone={tone === "danger" ? "danger" : "primary"} onClick={submit} data-confirm-yes-money={hook}>{confirmLabel}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
