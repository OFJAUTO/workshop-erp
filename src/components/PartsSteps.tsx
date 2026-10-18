import Link from "next/link";
import { type PartsStep } from "@/lib/parts-steps";

/**
 * The five parts steps across the top of a car's parts page (the bar), or as small dots on a list. Done steps are
 * green with a tick and can still be tapped to view; the current step is black and is the one button; later steps
 * are grey.
 */
export function PartsSteps({ steps, hrefs = {}, size = "bar" }: { steps: PartsStep[]; hrefs?: Partial<Record<PartsStep["key"], string>>; size?: "bar" | "dots" }) {
  if (size === "dots") {
    return (
      <span className="inline-flex items-center gap-1 align-middle" data-parts-dots title={steps.map((s) => `${s.label}: ${s.state === "done" ? "done" : s.state === "current" ? "now" : "later"}${s.detail ? ` (${s.detail})` : ""}`).join(" · ")}>
        {steps.map((s) => <span key={s.key} className={`inline-block h-2.5 w-2.5 rounded-full ${s.state === "done" ? "bg-green" : s.state === "current" ? "bg-white ring-2 ring-inset ring-ink" : "bg-line-strong"}`} data-step-dot={s.key} data-state={s.state} />)}
      </span>
    );
  }
  return (
    <ol className="flex flex-wrap items-center gap-1" data-parts-steps>
      {steps.map((s, i) => {
        const tone = s.state === "done" ? "border-green bg-green-soft text-green" : s.state === "current" ? "border-ink bg-ink text-white" : "border-line bg-chip text-muted";
        const href = s.state !== "later" ? hrefs[s.key] : undefined;
        const inner = (
          <span className={`inline-flex min-h-11 items-center gap-1.5 rounded-control border px-3 text-xs font-extrabold uppercase tracking-wide ${tone}`}>
            {s.state === "done" ? <span aria-hidden>✓</span> : null}
            <span>{s.label}</span>
            {s.detail ? <span className="font-semibold normal-case tracking-normal opacity-80">· {s.detail}</span> : null}
          </span>
        );
        return (
          <li key={s.key} className="flex items-center gap-1" data-step={s.key} data-state={s.state}>
            {href ? <Link href={href} aria-current={s.state === "current" ? "step" : undefined}>{inner}</Link> : inner}
            {i < steps.length - 1 ? <span className="px-0.5 text-muted" aria-hidden>→</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
