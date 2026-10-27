import { LINE_TEXT_MAX, textCounter } from "@/lib/text-limits";

/** THE live counter under a long-description box: grey while it fits, red (and nothing saved) above the limit. */
export function TextCounter({ length, max = LINE_TEXT_MAX }: { length: number; max?: number }) {
  const c = textCounter(length, max);
  if (!c) return null;
  return (
    <span className={`px-1 text-[11px] ${c.over ? "font-bold text-red" : "text-muted"}`} data-text-counter data-over={c.over ? "1" : "0"} aria-live="polite">
      {c.words}
    </span>
  );
}
