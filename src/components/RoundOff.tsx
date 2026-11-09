"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { ROUND_STEPS, fitTotal, roundTargets, roundoffCheck, roundoffWords, type RoundoffLimits } from "@/lib/roundoff";

const m = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * THE round-off control (3 November 2026): one button on every money document - quotation, estimate,
 * proforma (pending charges too). Off by default; the button opens the window with the nearest AED
 * 1 / 10 / 50 / 100 down or up and "Set the total to". The round-off adjusts the amount BEFORE VAT and
 * VAT is recalculated to exactly 5%, so the total lands on the chosen number. Advisors may round down
 * up to the AED limit (a quotation above it waits for the owner at Send; an invoice refuses), up at most
 * the up limit for everyone, and an invoice never above the approved quotation total.
 */
export function RoundOff({ docWords, baseTotal, baseNet, rounding, appliedTotal, vatPercent, isOwner, limits, approvedCap = null, refuseOverLimit = false, disabled = false, apply, size = "md" }: {
  /** "quotation" | "estimate" | "proforma" - only for the words. */
  docWords: string;
  /** The total and pre-VAT amount WITHOUT this document's round-off (the reset point). */
  baseTotal: number;
  baseNet: number;
  /** The round-off in force (pre-VAT, signed; 0 = none). */
  rounding: number;
  /** The total in force (with the round-off). */
  appliedTotal: number;
  vatPercent: number;
  isOwner: boolean;
  limits: RoundoffLimits;
  /** An invoice may never end above the approved quotation total. */
  approvedCap?: number | null;
  /** Invoices: over the advisor's limit is refused here (no owner-approval flow on invoices). */
  refuseOverLimit?: boolean;
  disabled?: boolean;
  apply: (target: number | null) => Promise<{ error?: string; needsOwner?: boolean; ok?: boolean }>;
  size?: "md" | "lg";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pct = (vatPercent || 5) / 100;
  const has = Math.abs(rounding) > 0.004;

  const previewOf = (target: number) => {
    const fit = fitTotal(target, pct);
    const check = roundoffCheck({ current: baseTotal, target: fit.total, isOwner, limits, approvedCap, refuseOverLimit });
    return { fit, check, words: `${roundoffWords(fit.taxable - baseNet)} → ${m(fit.taxable)} + VAT ${fit.vat.toLocaleString("en-GB", { minimumFractionDigits: 2 })} = ${m(fit.total)}` };
  };

  const go = (target: number | null) =>
    start(async () => {
      setError(null);
      setNote(null);
      if (target !== null) {
        const p = previewOf(target);
        if (p.check.error) {
          setError(p.check.error);
          return;
        }
      }
      const res = await apply(target);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.needsOwner) setNote(`Stored. It is above your AED ${limits.downMax.toLocaleString("en-GB")} limit, so it will go to the owner when you send.`);
      setOpen(false);
      setTyped("");
      router.refresh();
    });

  // Escape closes the window wherever the focus sits (the shared dialog rule).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const typedTarget = (() => {
    const clean = typed.replace(/,/g, "").trim();
    const n = Number(clean);
    return clean && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  })();
  const typedPreview = typedTarget !== null ? previewOf(typedTarget) : null;

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <Button type="button" tone="secondary" size={size} disabled={disabled || pending} onClick={() => { setError(null); setNote(null); setOpen(true); }} data-roundoff-open>
          {has ? roundoffWords(rounding) : "Round off"}
        </Button>
        {note && !open ? <span className="text-xs font-semibold text-amber-text" data-roundoff-owner-note>{note}</span> : null}
      </span>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label="Round off" onClick={() => setOpen(false)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} data-roundoff-dialog>
          <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card bg-white p-5 flex flex-col gap-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-extrabold">Round off the {docWords}</h2>
            <p className="text-sm font-semibold" data-roundoff-current>
              {has ? <>Total now {m(appliedTotal)} ({roundoffWords(rounding)}; {m(baseTotal)} before).</> : <>Total now {m(baseTotal)} incl. VAT.</>}
            </p>
            <div className="flex flex-col gap-1.5">
              {ROUND_STEPS.map((step) => {
                const t = roundTargets(baseTotal, step);
                const cell = (target: number | null, dir: "down" | "up") => {
                  if (target === null) return <span className="flex-1" />;
                  const p = previewOf(target);
                  const bad = !!p.check.error;
                  return (
                    <button
                      type="button"
                      disabled={pending || bad}
                      title={bad ? p.check.error : undefined}
                      onClick={() => go(target)}
                      className={`min-h-11 flex-1 rounded-control border px-2 text-sm font-bold ${bad ? "border-line text-muted opacity-50" : "border-line-strong bg-white"}`}
                      data-roundoff-step={`${step}-${dir}`}
                    >
                      {dir === "down" ? "↓" : "↑"} {m(target)}
                    </button>
                  );
                };
                return (
                  <div key={step} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-xs font-bold text-muted">Nearest {step === 1 ? "AED 1" : `AED ${step}`}</span>
                    {cell(t.down, "down")}
                    {cell(t.up, "up")}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <label className="text-sm font-bold" htmlFor="roundoff-set">Set the total to</label>
              <Input id="roundoff-set" value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="decimal" placeholder={String(Math.round(baseTotal))} style={{ width: "9rem" }} data-roundoff-set spell={false} />
              <Button type="button" size="md" disabled={pending || typedTarget === null || !!typedPreview?.check.error} onClick={() => typedTarget !== null && go(typedTarget)} data-roundoff-apply>Apply</Button>
            </div>
            {typedPreview ? <p className={`text-xs font-semibold ${typedPreview.check.error ? "text-red" : "text-muted"}`} data-roundoff-preview>{typedPreview.check.error ?? typedPreview.words}</p> : null}
            {!isOwner ? <p className="text-xs text-muted">Down up to AED {limits.downMax.toLocaleString("en-GB")}{refuseOverLimit ? "" : " (more goes to the owner at Send)"} · up at most AED {limits.upMax.toLocaleString("en-GB")}.</p> : null}
            {error ? <p className="text-sm font-semibold text-red" data-roundoff-error>{error}</p> : null}
            {note ? <p className="text-sm font-semibold text-amber-text" data-roundoff-note>{note}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="lg" tone="secondary" onClick={() => setOpen(false)} data-roundoff-cancel>Cancel</Button>
              {has ? <Button type="button" size="lg" tone="danger" disabled={pending} onClick={() => go(null)} data-roundoff-remove>Remove round-off</Button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
