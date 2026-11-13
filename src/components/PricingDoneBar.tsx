"use client";
import { CheckBeforeSend, type CheckGroup } from "./CheckBeforeSend";

import { useActionState, useEffect, useRef, useState } from "react";
import { formatDateTime } from "@/lib/format";
import type { FormState } from "@/lib/form-state";
import { openLinesWords, type PricingProgress } from "@/lib/pricing-done";

type SendAction = (state: FormState, formData: FormData) => Promise<FormState>;
type Action = (formData: FormData) => void | Promise<void>;

/**
 * THE pricing bar (section 10, 3 November 2026), fixed to the bottom of the parts desk's pricing screens - a job's parts
 * and an estimate's parts alike. It always shows the progress ("3 of 4 priced") and one big button, "Pricing done –
 * send to advisor". With a line not priced yet the button does not send: the lines are listed right above it, each with
 * Go to (the list folds away, the screen scrolls the row above the bar and the cursor lands in what is missing), with Go
 * to next and, for when the supplier cannot answer today, Send what you have. The answer of the send shows in the bar
 * itself, whatever state the bar is in.
 *
 *   open     nothing sent yet: "Pricing done – send to advisor"
 *   editing  sent before, changed since (Edit on a job, a new price on an estimate): "Send updated prices"
 *   sent     sent and nothing changed since: green, with Edit (jobs) and Back to the parts desk; lines left open by
 *            "Send what you have" are named, with how to finish them
 */
export function PricingDoneBar({ progress, mode, sentAt = null, action, onReopen = null, rowSelector, onAttempt, extra = null, backHref = "/parts", editingWords = null, refLabel, check = null }: {
  /** 13 November 2026: CHECK BEFORE YOU SEND - the prices going to the advisor, shown and checked first. */
  check?: { groups: CheckGroup[]; total?: string | null; log: (flags: { key: string; name: string; flags: string[] }[]) => Promise<void> } | null;
  progress: PricingProgress;
  mode: "open" | "editing" | "sent";
  sentAt?: string | null;
  action: SendAction;
  /** Edit after the send (jobs): the rows open again. */
  onReopen?: Action | null;
  /** The CSS selector of a line on the screen, for Go to. */
  rowSelector: (key: string) => string;
  /** The open lines get their red outline on the screen while the list is open. */
  onAttempt?: (on: boolean) => void;
  /** The cost line (Parts, advisors and the owner only). */
  extra?: React.ReactNode;
  backHref?: string;
  /** What the editing state says ("Editing: the advisor sees the old prices…"). */
  editingWords?: string | null;
  /** "J-00970" / "E-00058": named in the button's title. */
  refLabel: string;
}) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const formRef = useRef<HTMLFormElement>(null);
  const [checkForce, setCheckForce] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // After Go to the list folds into one slim line (the row it jumped to must not sit behind it).
  const [jumping, setJumping] = useState(false);
  const [lastJump, setLastJump] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // Every answer of the send (prev-value pattern): a success closes the list; the words stay next to the button until
  // the pricing is opened again (Edit), whatever state the bar was in when it answered.
  const [seenState, setSeenState] = useState(state);
  const [shown, setShown] = useState<FormState | null>(null);
  if (seenState !== state) {
    setSeenState(state);
    setShown(state);
    if (state.success) {
      setListOpen(false);
      setJumping(false);
    }
  }
  const [seenMode, setSeenMode] = useState(mode);
  if (seenMode !== mode) {
    setSeenMode(mode);
    if (mode === "editing") setShown(null);
  }
  const answer = shown === state ? state : ({} as FormState);
  // A send that answered with an error, or the lines finished meanwhile: the list follows what is still open.
  const open = progress.openLines;
  useEffect(() => {
    if (!listOpen && !jumping) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setListOpen(false); setJumping(false); onAttempt?.(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listOpen, jumping, onAttempt]);

  function goTo(key: string) {
    const el = document.querySelector<HTMLElement>(rowSelector(key));
    if (!el) return;
    setLastJump(key);
    // The list folds to one line so it covers nothing; the red outlines stay on (onAttempt).
    setListOpen(false);
    setJumping(true);
    // After the bar has shrunk: the row's middle in the middle of what is left above the bar.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const barTop = barRef.current?.getBoundingClientRect().top ?? window.innerHeight;
        const r = el.getBoundingClientRect();
        const target = Math.max(8, (barTop - r.height) / 2);
        window.scrollBy({ top: r.top - target, behavior: "smooth" });
        // The cursor lands in the box outlined red (the missing piece), else in the first empty one.
        const marked = el.querySelector<HTMLInputElement | HTMLSelectElement>("input.border-red-bar, select.border-red-bar");
        const empty = Array.from(el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")).find((c) => !c.disabled && c.value.trim() === "" && c.getAttribute("aria-label") !== "Brand" && c.offsetParent !== null);
        (marked ?? empty)?.focus({ preventScroll: true });
      }),
    );
  }
  function goNext() {
    if (!open.length) return;
    const i = open.findIndex((l) => l.key === lastJump);
    goTo(open[(i + 1) % open.length].key);
  }
  const big = mode === "editing" ? "Send updated prices" : "Pricing done – send to advisor";
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const showList = listOpen && open.length > 0 && mode !== "sent";
  const showStrip = !showList && jumping && open.length > 0 && mode !== "sent";
  const lastIndex = open.findIndex((l) => l.key === lastJump);

  return (
    <div ref={barRef} className="fixed bottom-0 left-0 right-0 nav:left-60 z-40 border-t border-line bg-white px-4 py-2.5" data-pricing-bar data-pricing-mode={mode}>
      <form action={formAction} ref={formRef} className="mx-auto flex max-w-6xl flex-col gap-2">
        {check ? <input type="hidden" name="force" defaultValue="" data-pricing-force /> : null}
        {check ? (
          <CheckBeforeSend
            open={checkForce !== null}
            title={`Send these prices to the advisor (${refLabel})?`}
            groups={check.groups}
            total={check.total ?? null}
            onBack={() => setCheckForce(null)}
            onSend={(flags) => { const f = checkForce ?? ""; void check.log(flags).catch(() => null).finally(() => { const box = formRef.current?.querySelector<HTMLInputElement>("[data-pricing-force]"); if (box) box.value = f; setCheckForce(null); formRef.current?.requestSubmit(); }); }}
          />
        ) : null}
        {showList ? (
          // The answer to the tap, right above the button: the lines still open (never sent while they are).
          <div className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto rounded-card border-2 border-red-bar bg-white p-3" data-pricing-open-list role="dialog" aria-label={openLinesWords(progress)}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-extrabold text-red" data-pricing-open-count={open.length}>{openLinesWords(progress)}</span>
              <span className="text-xs text-muted">Finish {open.length === 1 ? "it" : "them"} and tap the button again, or send what you have.</span>
              <button type="button" onClick={() => { setListOpen(false); setJumping(false); onAttempt?.(false); }} className="ml-auto min-h-11 min-w-11 rounded-control text-lg font-bold hover:bg-chip" aria-label="Close the list">✕</button>
            </div>
            <ul className="flex flex-col divide-y divide-line">
              {open.map((l) => (
                <li key={l.key} className="flex flex-wrap items-center gap-2 py-1.5" data-pricing-open-line={l.key}>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-bold uppercase">{l.name || "(no name)"}</span>
                    <span className="text-red"> · {l.state === "waiting_approval" ? "waiting for the owner's approval of the discount" : l.missing.join(", ") || "not finished"}</span>
                  </span>
                  <button type="button" onClick={() => goTo(l.key)} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-sm font-bold" data-pricing-go={l.key}>Go to</button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              {open.length > 1 ? <button type="button" onClick={goNext} className="min-h-11 rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-pricing-go-next>Go to next</button> : null}
              <button type={check ? "button" : "submit"} name={check ? undefined : "force"} value="1" onClick={check ? () => setCheckForce("1") : undefined} className="min-h-11 rounded-control border border-ink bg-white px-4 text-sm font-bold" data-pricing-send-anyway>Send what you have</button>
              <span className="text-xs text-muted">The advisor gets the priced parts now; the rest stay on your To price list until they are priced.</span>
            </div>
          </div>
        ) : null}
        {showStrip ? (
          // Go to was tapped: one slim line, so the row the screen moved to stays in sight above the bar.
          <div className="flex flex-wrap items-center gap-2 rounded-control border-2 border-red-bar bg-white px-2 py-1" data-pricing-jump-strip>
            <span className="text-sm font-bold text-red">{openLinesWords(progress)}{lastIndex >= 0 ? ` · ${lastIndex + 1} of ${open.length}` : ""}</span>
            {open.length > 1 ? <button type="button" onClick={goNext} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-sm font-bold" data-pricing-go-next>Go to next</button> : null}
            <button type="button" onClick={() => { setJumping(false); setListOpen(true); }} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-sm font-bold" data-pricing-show-list>Show the list</button>
            <button type="button" onClick={() => { setJumping(false); onAttempt?.(false); }} className="ml-auto min-h-11 min-w-11 rounded-control text-lg font-bold hover:bg-chip" aria-label="Close">✕</button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-x-2 text-sm">
              <span className="font-extrabold" data-pricing-progress={`${progress.done}/${progress.total}`}>{progress.words}</span>
              {progress.detail ? <span className="text-xs text-muted" data-bar-text>{progress.detail}</span> : <span className="text-xs text-muted" data-bar-text>{progress.total && !progress.open ? "Every part is priced or marked not available" : ""}</span>}
            </span>
            <span className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-track"><span className={`block h-full ${progress.open ? "bg-ink" : "bg-green"}`} style={{ width: `${pct}%` }} /></span>
            {mode === "editing" && editingWords ? <span className="text-xs font-semibold text-amber-text" data-pricing-editing>{editingWords}</span> : null}
            {mode === "sent" && open.length ? (
              // Sent with "Send what you have": the lines left open are still the desk's (on the To price list).
              <span className="text-xs font-semibold text-amber-text" data-pricing-sent-open={open.length}>
                {openLinesWords(progress)}: {open.slice(0, 3).map((l) => l.name.toUpperCase()).join(", ")}{open.length > 3 ? "…" : ""}. {onReopen ? "Tap Edit to price them, then Send updated prices." : "Price them above, then Send updated prices."}
              </span>
            ) : null}
            {answer.error ? <span className="text-sm font-semibold text-red" data-pricing-error>{answer.error}</span> : null}
            {answer.success ? <span className="text-sm font-semibold text-green-text" data-pricing-sent>✓ {answer.success}</span> : null}
          </div>
          {mode === "sent" ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="inline-flex min-h-11 items-center gap-2 rounded-control bg-green-soft px-3 text-sm font-bold text-green-text" data-pricing-locked>✓ Sent to the advisor{sentAt ? ` · ${formatDateTime(sentAt)}` : ""}</span>
              {/* 5 November 2026: labels that say what they do (the owner's item 6). */}
              {onReopen ? <button type="submit" formAction={onReopen} className="min-h-12 rounded-control border border-line-strong bg-white px-5 text-sm font-bold" data-pricing-edit>Change prices (reopens pricing)</button> : null}
              <a href={backHref} className="inline-flex min-h-12 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-pricing-back>← All cars on the parts desk</a>
            </div>
          ) : (
            <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
              {open.length ? (
                <button type="button" onClick={() => { setJumping(false); setListOpen(true); onAttempt?.(true); }} className="min-h-12 w-full rounded-control bg-ink px-6 text-base font-extrabold text-on-dark sm:w-auto" title={`${refLabel}: ${openLinesWords(progress)}`} data-pricing-done data-pricing-done-open={open.length}>
                  {big}
                </button>
              ) : (
                <button type={check ? "button" : "submit"} name={check ? undefined : "force"} value="" onClick={check ? () => setCheckForce("") : undefined} disabled={!progress.count} className="min-h-12 w-full rounded-control bg-ink px-6 text-base font-extrabold text-on-dark disabled:opacity-40 sm:w-auto" title={`${refLabel}: send every price to the advisor`} data-pricing-done>
                  {big}
                </button>
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
