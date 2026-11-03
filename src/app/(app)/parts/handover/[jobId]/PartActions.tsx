"use client";

import { ReasonChips } from "@/components/ReasonChips";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { CopyText } from "@/components/CopyText";
import { ReleaseFormLock } from "@/components/forms";
import { QueuedProofView, useQueuedProof } from "@/components/QueuedProofUpload";
import { Badge, Button, Input, Textarea } from "@/components/ui";
import { reloadIfStale } from "@/lib/app-version";
import { DISPOSITIONS, EXCHANGE_REASONS, type PartState } from "@/lib/part-state";
import type { EndingChoices, EndingKey } from "@/lib/part-endings";
import type { EndingAnswer } from "../../handover-actions";

type Action = (formData: FormData) => void | Promise<void>;
/** An ending's save: its answer comes back to the card that was tapped (3 November 2026). */
type AnswerAction = (formData: FormData) => Promise<EndingAnswer>;

/* ---------- The result of an ending, in a window on the page (the card itself leaves the list when it is saved) ---------- */

type Shown = { message: string; supplierCopy: { supplier: string; text: string } | null };
let shown: Shown | null = null;
const listeners = new Set<() => void>();
function showEndingResult(next: Shown | null) {
  shown = next;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/**
 * Once per page (Returns and leftovers, the handover page): the saved ending's words and the message for the supplier,
 * ready to copy, in a centre window - the card that was tapped has left the list by then.
 */
export function EndingResultHost() {
  const s = useSyncExternalStore(subscribe, () => shown, () => null);
  useEffect(() => {
    if (!s) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") showEndingResult(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s]);
  if (!s) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={() => showEndingResult(null)}>
      <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card bg-white p-5 flex flex-col gap-3" role="dialog" aria-modal="true" aria-label="Saved" onClick={(e) => e.stopPropagation()} data-ending-result>
        <span className="text-lg font-extrabold">Saved ✓</span>
        <p className="text-sm font-semibold text-green break-words" data-ending-result-message>{s.message}</p>
        {s.supplierCopy ? (
          <div className="flex flex-col gap-2 rounded-control border border-line bg-chip p-3" data-ending-result-copy>
            <span className="text-xs font-bold">Tell {s.supplierCopy.supplier}:</span>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">{s.supplierCopy.text}</pre>
            <div><CopyText text={s.supplierCopy.text} label="Copy for the supplier" /></div>
          </div>
        ) : null}
        <div><Button type="button" size="md" onClick={() => showEndingResult(null)} data-ending-result-close>Close</Button></div>
      </div>
    </div>
  );
}

/**
 * The card's own save: the server's answer stays here - an error in red inside the card (nothing was saved; the next
 * tap is not swallowed), the result in the page's window.
 */
function useEndingSave(action: AnswerAction) {
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [pending, start] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      let r: EndingAnswer;
      try {
        r = await action(fd);
      } catch (err) {
        r = { error: reloadIfStale(err) ? "A new version of the app is loading: the page reloads by itself, then save the ending again." : "Not saved: no connection. Nothing was changed – try again." };
      }
      if (r.error) {
        setError(r.error);
        setTries((n) => n + 1);
      } else showEndingResult({ message: r.message ?? "Saved.", supplierCopy: r.supplierCopy ?? null });
    });
  };
  const errorBox = error ? (
    <>
      <p role="alert" className="rounded-control border border-red-bar bg-white px-3 py-2 text-sm font-semibold text-red break-words" data-ending-error>{error}</p>
      <ReleaseFormLock key={tries} />
      <WakeSubmit key={`w${tries}`} />
    </>
  ) : null;
  return { pending, onSubmit, errorBox };
}

/** With the answer on screen, the form's submit button takes the next tap at once (FormGuard dims it for five seconds). */
function WakeSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    form?.querySelectorAll<HTMLElement>("button[type='submit']").forEach((b) => {
      b.style.opacity = "";
      b.style.pointerEvents = "";
      delete b.dataset.busy;
    });
  }, []);
  return <span ref={ref} hidden />;
}

/** The one state of a part, as a small tag. */
export function PartStateBadge({ state }: { state: PartState }) {
  return <Badge tone={state.tone}>{state.label}</Badge>;
}

/**
 * Under a part on the handover page: "Wrong or faulty" (one-tap reason, then the exchange starts) and
 * "Not needed" (a reason). Only the input the chosen action needs opens, and closes when done.
 */
export function PartActions({ partId, back, canExchange, canNotNeeded, exchangeAction, notNeededAction, notNeededReasons = [] }: { partId: string; back?: string; canExchange: boolean; canNotNeeded: boolean; exchangeAction: Action; notNeededAction: Action; /** One-tap reasons for "not needed" (Settings). */ notNeededReasons?: string[] }) {
  const [open, setOpen] = useState<null | "exchange" | "not_needed">(null);
  const [reason, setReason] = useState("");
  if (!canExchange && !canNotNeeded) return null;
  if (open === "exchange") {
    return (
      <form action={exchangeAction} className="flex flex-col gap-2 rounded-control border border-line bg-white p-3">
        <input type="hidden" name="part" value={partId} />
        {back ? <input type="hidden" name="back" value={back} /> : null}
        <span className="text-sm font-semibold">What is wrong with it?</span>
        <div className="flex flex-wrap gap-1.5">
          {EXCHANGE_REASONS.map((r) => (
            <button key={r.value} type="button" onClick={() => setReason(r.value)} aria-pressed={reason === r.value} className={`min-h-10 rounded-control border px-3 text-sm font-bold ${reason === r.value ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>{reason === r.value ? "✓ " : ""}{r.label}</button>
          ))}
        </div>
        <input type="hidden" name="reason" value={reason} />
        <Textarea name="note" rows={1} placeholder="Note (optional): part number on the box, what was wrong" textCase="sentence" className="min-h-12" />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="md" disabled={!reason}>Back to the supplier, order the correct part</Button>
          <Button type="button" tone="ghost" size="md" onClick={() => { setOpen(null); setReason(""); }}>Cancel</Button>
        </div>
      </form>
    );
  }
  if (open === "not_needed") {
    return (
      <form action={notNeededAction} className="flex flex-col gap-2 rounded-control border border-line bg-white p-3">
        <input type="hidden" name="part" value={partId} />
        {back ? <input type="hidden" name="back" value={back} /> : null}
        <ReasonChips name="reason" label="Why is it not needed?" options={notNeededReasons} required placeholder="For example: the old one was fine after cleaning" textCase="sentence" />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="md">Mark not needed</Button>
          <Button type="button" tone="ghost" size="md" onClick={() => setOpen(null)}>Cancel</Button>
        </div>
      </form>
    );
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {canExchange ? <button type="button" onClick={() => setOpen("exchange")} className="min-h-9 rounded-control border border-line-strong bg-white px-2.5 text-xs font-bold">Wrong or faulty part</button> : null}
      {canNotNeeded ? <button type="button" onClick={() => setOpen("not_needed")} className="min-h-9 rounded-control border border-line-strong bg-white px-2.5 text-xs font-bold">Not needed</button> : null}
    </span>
  );
}

/**
 * Where a part without a home goes. A part not needed takes THE endings (3 November 2026, src/lib/part-endings.ts):
 * Cancelled with the supplier (nothing delivered), Return to supplier (the credit note now, or later - tracked), Keep in
 * stock; once delivered it can also be fitted with the owner's approval or scrapped. A wrong or faulty part being
 * exchanged keeps its own endings (back to the supplier with the credit note, stock, fit, scrap).
 */
export function EndingForm({ partId, back, action, endings = null }: { partId: string; back?: string; action: AnswerAction; /** The endings that fit this part (a part not needed); none for a part being exchanged. */ endings?: EndingChoices | null }) {
  const [choice, setChoice] = useState(endings?.suggested === "return" ? "returned" : endings?.suggested ?? "");
  const { pending, onSubmit, errorBox } = useEndingSave(action);
  if (endings) {
    const delivered = !!endings.options.find((o) => o.key === "stock")?.allowed;
    const extra = delivered ? DISPOSITIONS.filter((d) => d.value === "fit_pending" || d.value === "scrap") : [];
    const valueOf = (k: EndingKey) => (k === "return" ? "returned" : k);
    if (endings.refusal) return <p className="text-xs font-semibold text-muted" data-ending-refusal>{endings.refusal}</p>;
    return (
      <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-control border border-line bg-white p-3" data-ending-form={partId}>
        <input type="hidden" name="part" value={partId} />
        {back ? <input type="hidden" name="back" value={back} /> : null}
        <span className="text-sm font-semibold">Its ending</span>
        <div className="flex flex-wrap gap-1.5">
          {endings.options.map((o) => (
            <button key={o.key} type="button" disabled={!o.allowed} onClick={() => setChoice(valueOf(o.key))} aria-pressed={choice === valueOf(o.key)} title={o.allowed ? o.help : (o.why ?? "")} className={`min-h-11 rounded-control border px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${choice === valueOf(o.key) ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`} data-ending-choice={o.key}>{choice === valueOf(o.key) ? "✓ " : ""}{o.label}</button>
          ))}
          {extra.map((d) => (
            <button key={d.value} type="button" onClick={() => setChoice(d.value)} aria-pressed={choice === d.value} className={`min-h-11 rounded-control border px-3 text-sm font-bold ${choice === d.value ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>{choice === d.value ? "✓ " : ""}{d.label}</button>
          ))}
        </div>
        <span className="text-xs text-muted">{endings.options.find((o) => valueOf(o.key) === choice)?.help ?? (choice === "fit_pending" ? "The owner approves it as goodwill; the part then goes to the technician as usual." : choice === "scrap" ? "It is thrown away: say why." : "")}</span>
        {endings.partly ? <span className="text-xs font-semibold text-amber">{endings.partly}</span> : null}
        <input type="hidden" name="disposition" value={choice} />
        {choice === "fit_pending" || choice === "scrap" ? (
          <>
            <Textarea name="note" rows={1} placeholder={choice === "scrap" ? "Why it is scrapped (required)" : "Why fit it anyway (the owner reads this)"} textCase="sentence" className="min-h-12" required={choice === "scrap"} />
            {errorBox}
            <div><Button type="submit" size="md" disabled={pending} data-ending-save>{pending ? "Saving…" : "Save the ending"}</Button></div>
          </>
        ) : (
          <>
            <Textarea name="reason" rows={1} placeholder="Why it is not needed (optional when already given)" textCase="sentence" className="min-h-12" />
            {choice === "returned" ? (
              <ReturnedFields key={partId} partId={partId} optional pending={pending} errorBox={errorBox} />
            ) : (
              <>
                {errorBox}
                <div><Button type="submit" size="md" disabled={!choice || pending} data-ending-save>{pending ? "Saving…" : "Save the ending"}</Button></div>
              </>
            )}
          </>
        )}
      </form>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-control border border-line bg-white p-3" data-ending-form={partId}>
      <input type="hidden" name="part" value={partId} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <span className="text-sm font-semibold">Where does it go?</span>
      <div className="flex flex-wrap gap-1.5">
        {DISPOSITIONS.map((d) => (
          <button key={d.value} type="button" onClick={() => setChoice(d.value)} aria-pressed={choice === d.value} className={`min-h-10 rounded-control border px-3 text-sm font-bold ${choice === d.value ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>{choice === d.value ? "✓ " : ""}{d.label}</button>
        ))}
      </div>
      <input type="hidden" name="disposition" value={choice} />
      {choice === "returned" ? (
        <ReturnedFields key={partId} partId={partId} pending={pending} errorBox={errorBox} />
      ) : (
        <>
          {choice ? <Textarea name="note" rows={1} placeholder={choice === "stock" ? "Shelf or bin (optional)" : choice === "scrap" ? "Why it is scrapped (required)" : "Why fit it anyway (the owner reads this)"} textCase="sentence" className="min-h-12" required={choice === "scrap"} /> : null}
          {choice === "fit_pending" ? <span className="text-xs text-muted">The owner approves it as goodwill; the part then goes to the technician as usual.</span> : null}
          {errorBox}
          <div><Button type="submit" size="md" disabled={!choice || pending} data-ending-save>{pending ? "Saving…" : "Save the ending"}</Button></div>
        </>
      )}
    </form>
  );
}

/**
 * Returned to the supplier: the credit note number and/or its scan (31 October 2026: the scan is kept on this device until
 * OFJ's server has it and goes straight to storage). With a number typed the ending can be saved at once and a scan still
 * on its way lands on the part by itself; without a number it waits for the scan, because the ending needs one of them.
 */
function ReturnedFields({ partId, optional = false, requireOne = false, submitLabel = "Save the ending", pending = false, errorBox = null }: { partId: string; /** The return can be saved without the credit note: it is then awaited and tracked (3 November 2026). */ optional?: boolean; /** Recording the credit note itself: the number or the scan is needed. */ requireOne?: boolean; submitLabel?: string; /** The save is with the server. */ pending?: boolean; /** The server's refusal, shown right above the button. */ errorBox?: React.ReactNode }) {
  const [number, setNumber] = useState("");
  const scan = useQueuedProof({ target: "credit_note", scopeId: partId });
  const waitForScan = !number.trim() && !scan.ready && (scan.waiting || scan.stopped);
  const nothing = requireOne && !number.trim() && !scan.ready;
  return (
    <>
      {optional ? <span className="text-xs text-muted" data-credit-note-optional>No credit note yet? Save without it: the part is listed under &quot;Waiting for a supplier credit note&quot; until it comes.</span> : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Credit note number{optional ? " (if you have it)" : ""}<Input name="note" placeholder="From the supplier" textCase="upper" onChange={(e) => setNumber(e.target.value)} spell={false} data-credit-note-number /></label>
        {optional || requireOne ? (
          <>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Amount before VAT (optional)<Input name="credit_amount" inputMode="decimal" placeholder="AED" spell={false} data-credit-note-amount /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Date on the credit note (optional)<Input name="credit_date" type="date" data-credit-note-date /></label>
          </>
        ) : null}
        <div className="flex flex-col gap-1 text-xs font-semibold text-muted" data-credit-note-scan>
          <span>Scan of the credit note (optional)</span>
          <QueuedProofView
            proof={scan}
            label={scan.ready || scan.waiting ? "Use another scan" : "Add the scan"}
            buttonClass="min-h-11 w-fit rounded-control border border-line-strong bg-white px-4 text-sm font-bold text-ink disabled:opacity-50"
            buttonData={{ "data-credit-note-upload": "" }}
            inputData={{ "data-credit-note-file": "" }}
            pathName="credit_note_path"
            pendingName="credit_note_pending"
            readyWords="Scan ready"
            waitingHint={number.trim() ? "You can save now: the scan joins the part by itself when it arrives." : undefined}
          />
        </div>
      </div>
      {waitForScan ? <span className="text-xs font-semibold text-amber" data-credit-note-wait>{scan.stopped ? "The scan could not be sent: type the credit note number, or remove the scan and add it again." : "Type the credit note number, or wait for the scan to finish sending."}</span> : null}
      {errorBox}
      <div><Button type="submit" size="md" disabled={waitForScan || nothing || pending} data-ending-save>{pending ? "Saving…" : submitLabel}</Button></div>
    </>
  );
}

/** "Record the credit note" on a part returned to the supplier and still waiting for it (3 November 2026). */
export function CreditNoteForm({ partId, back, action }: { partId: string; back?: string; action: AnswerAction }) {
  const { pending, onSubmit, errorBox } = useEndingSave(action);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-control border border-line bg-white p-3" data-credit-note-form={partId}>
      <input type="hidden" name="part" value={partId} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <ReturnedFields key={partId} partId={partId} requireOne submitLabel="Record the credit note" pending={pending} errorBox={errorBox} />
    </form>
  );
}
