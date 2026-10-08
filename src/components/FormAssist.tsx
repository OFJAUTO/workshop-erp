"use client";

import { useEffect, useState } from "react";

export type Problem = { key: string; label: string };

/**
 * The bar at the bottom of a long form. Before the person taps Submit it shows neutral progress
 * ("12 of 99 done"); after a Submit with something missing it lists the problems as red buttons
 * that scroll to the item and outline it, updating as things are fixed. The round arrow jumps to
 * the bottom or back to the top. Used by the inspection report, the road test and the gate-in form.
 */
export function ProblemsBar({
  problems,
  attempted,
  progress,
  onJump,
  submitLabel,
  onSubmit,
  submitting = false,
}: {
  problems: Problem[];
  /** True once Submit was tapped with something missing: from then on the problems show in red. */
  attempted: boolean;
  /** Neutral progress shown before that. */
  progress?: { done: number; total: number };
  onJump: (key: string) => void;
  submitLabel: string;
  onSubmit?: () => void;
  submitting?: boolean;
}) {
  const shown = problems.slice(0, 4);
  const more = problems.length - shown.length;
  const showRed = attempted && problems.length > 0;
  return (
    <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 border-t border-line bg-white/95 backdrop-blur px-4 py-3 sm:px-6 lg:px-8 flex flex-wrap items-center gap-2">
      {showRed ? (
        <>
          <span className="text-xs font-bold text-red mr-1">{problems.length} to fix</span>
          {shown.map((p) => (
            <button key={p.key} type="button" onClick={() => onJump(p.key)} className="min-h-11 rounded-control border-2 border-red-bar bg-red-soft px-3 text-sm font-bold text-red">
              {p.label}
            </button>
          ))}
          {more > 0 ? <span className="text-sm font-bold text-red">+{more} more</span> : null}
        </>
      ) : problems.length === 0 ? (
        <span className="text-xs font-bold text-green mr-1">Everything is filled in</span>
      ) : progress ? (
        <span className="text-xs font-bold text-muted mr-1">
          {progress.done} of {progress.total} done
        </span>
      ) : (
        <span className="text-xs font-bold text-muted mr-1">{problems.length} still to do</span>
      )}
      {onSubmit ? (
        <button type="button" onClick={onSubmit} disabled={submitting} className={`ml-auto min-h-12 rounded-control px-5 text-sm font-bold text-white ${showRed ? "bg-ink/40" : "bg-ink"}`}>
          {submitting ? "Sending…" : submitLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Smooth scroll to a page position, falling back to an instant jump where smooth scrolling does nothing (some embedded browsers). */
function scrollPageTo(top: number) {
  const start = window.scrollY;
  window.scrollTo({ top, behavior: "smooth" });
  setTimeout(() => {
    if (Math.abs(window.scrollY - start) < 2 && Math.abs(top - start) > 2) window.scrollTo({ top });
  }, 400);
}

/** Scrolls an element with this id into view and outlines it in red for a moment. */
export function jumpTo(key: string) {
  const el = document.getElementById(`item-${key}`);
  if (!el) return;
  const details = el.closest("details");
  if (details && !details.open) details.open = true;
  const rect = el.getBoundingClientRect();
  scrollPageTo(window.scrollY + rect.top - Math.max(0, (window.innerHeight - rect.height) / 2));
  el.classList.add("ring-2", "ring-red-bar", "rounded-card");
  setTimeout(() => el.classList.remove("ring-2", "ring-red-bar"), 2500);
}

/** A small round button at the bottom right: down arrow jumps to the bottom, up arrow back to the top. */
export function JumpButton() {
  const [atBottom, setAtBottom] = useState(false);
  useEffect(() => {
    const onScroll = () => setAtBottom(window.innerHeight + window.scrollY >= document.body.scrollHeight - 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button
      type="button"
      aria-label={atBottom ? "Back to the top" : "Jump to the bottom"}
      onClick={() => scrollPageTo(atBottom ? 0 : document.body.scrollHeight)}
      className="fixed bottom-20 right-4 z-40 h-12 w-12 rounded-full border border-line-strong bg-white text-xl font-bold shadow-lg"
    >
      {atBottom ? "↑" : "↓"}
    </button>
  );
}

/** Reads a plain form's required fields and names what is still empty, using each field's label. */
export function formProblems(form: HTMLFormElement): Problem[] {
  return formFields(form).filter((f) => !f.valid).map((f) => ({ key: f.key, label: `${f.label}: missing` }));
}

/** Every required field of a plain form with whether it is filled in. */
export function formFields(form: HTMLFormElement): { key: string; label: string; valid: boolean }[] {
  const out: { key: string; label: string; valid: boolean }[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    if (!el.name || seen.has(el.name)) continue;
    if (el.type === "hidden" || el.disabled) continue;
    const group = el.type === "radio" ? (Array.from(form.elements) as HTMLInputElement[]).filter((x) => x.name === el.name) : [el];
    const required = group.some((x) => x.required) || (el.type === "radio" && group.length > 0 && group.some((x) => x.dataset.required === "true"));
    if (!required) continue;
    seen.add(el.name);
    const valid = el.type === "radio" ? group.some((x) => x.checked) : el.checkValidity();
    const labelEl = el.closest("[data-field]") ?? el.closest("label") ?? el.closest("fieldset");
    const label = (labelEl?.querySelector("[data-field-label]")?.textContent ?? labelEl?.textContent ?? el.name).trim().split("\n")[0].slice(0, 40);
    out.push({ key: el.name, label, valid });
  }
  return out;
}
