"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, type FormAction } from "./forms";
import { Button, Textarea, controlClass } from "./ui";
import { Words } from "./Words";
import { CopyText } from "./CopyText";

/**
 * THE back-order box (13 November 2026, URGENT, J-00317): in the Work complete box and on the job card. For each part
 * not handed to the technician: "Still coming for this visit" (it keeps blocking, as before) or "Back order - fit on a
 * later visit" (reason, the shared labour line's hours for later, who pays when). One component, one action.
 */

export type BackOrderCandidate = {
  partId: string; name: string; expected: string | null; orderWords: string; lpo: string | null; supplierPaid: string;
  line: { id: string; quotationId: string; number: string; amount: number } | null; suggestLabourId: string | null;
};
export type BackOrderLabour = { id: string; title: string; hours: number; amount: number; number: string };
export type BackOrderExisting = { id: string; partName: string; status: string; words: string; followJobId: string | null; followNumber: string | null; isFollowUp: boolean; continuesNumber: string | null; continuesJobId: string | null; movedTotal: number | null; hours: number; payMode: string; expected: string | null; /** The part arrived: the customer's draft message (the follow-up job). */ message?: string | null; phoneDigits?: string | null };

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "no date yet");

export function BackOrderBox({ candidates, labour, existing, action, mayDecide, mayRequest, blocked }: {
  candidates: BackOrderCandidate[];
  labour: BackOrderLabour[];
  existing: BackOrderExisting[];
  action: FormAction;
  /** Owner, workshop manager, bodyshop manager: applied at once (except "pays when fitted"). */
  mayDecide: boolean;
  /** Also an advisor: sent to the owner. */
  mayRequest: boolean;
  /** Why nothing can be put on back order now (a tax invoice is out, the database update is waiting). */
  blocked?: string | null;
}) {
  if (!candidates.length && !existing.length) return null;
  return (
    <div className="flex flex-col gap-3" id="back-orders" data-back-order-box>
      {existing.length ? (
        <ul className="flex flex-col gap-2" data-back-order-list>
          {existing.map((e) => (
            <li key={e.id} className={`rounded-md border p-3 text-sm ${e.status === "pending" ? "border-amber-bar" : e.status === "refused" ? "border-line" : "border-ink"}`} data-back-order={e.id} data-back-order-status={e.status}>
              <p className="font-bold uppercase"><Words text={e.partName} /> · <span data-back-order-words>{e.words}</span></p>
              {e.isFollowUp ? (
                <>
                  <p className="text-xs text-muted" data-continues>Continues {e.continuesJobId ? <Link className="underline" href={`/jobs/${e.continuesJobId}`}>{e.continuesNumber}</Link> : e.continuesNumber}: the customer already approved this work. Expected {day(e.expected)}. Our 6-month warranty on the part starts on the day it is fitted.</p>
                  {e.message ? (
                    <div className="mt-2 flex flex-col gap-2 rounded-md bg-surface p-3" data-arrived-message>
                      <p className="text-xs font-semibold">Message for the customer: book the visit</p>
                      <p className="whitespace-pre-line text-sm">{e.message}</p>
                      <div className="flex flex-wrap gap-2">
                        {e.phoneDigits ? <a className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white" href={`https://wa.me/${e.phoneDigits}?text=${encodeURIComponent(e.message)}`} target="_blank" rel="noreferrer" data-arrived-whatsapp>WhatsApp the customer</a> : null}
                        <CopyText text={e.message} />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-muted">
                  {e.followJobId ? <>Fitted on a later visit: <Link className="underline font-semibold" href={`/jobs/${e.followJobId}`} data-back-order-follow>{e.followNumber}</Link>. </> : null}
                  {e.hours > 0 ? `${e.hours.toFixed(1)} h of labour moved with it. ` : ""}
                  {e.movedTotal !== null ? <>Moved to the later visit: <span className="whitespace-nowrap">{aed(e.movedTotal)}</span> with VAT. </> : null}
                  {e.payMode === "when_fitted" ? "The customer pays when it is fitted." : "The customer pays for the part now (an advance on the later visit)."}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {blocked && candidates.length ? <p className="text-sm text-muted" data-back-order-blocked>{blocked}</p> : null}
      {!blocked && mayRequest
        ? candidates.map((c) => <CandidateForm key={c.partId} c={c} labour={labour} action={action} mayDecide={mayDecide} />)
        : null}
    </div>
  );
}

function CandidateForm({ c, labour, action, mayDecide }: { c: BackOrderCandidate; labour: BackOrderLabour[]; action: FormAction; mayDecide: boolean }) {
  const [choice, setChoice] = useState<"coming" | "later">("coming");
  const [labourId, setLabourId] = useState<string>(c.suggestLabourId ?? "");
  const [later, setLater] = useState<string>("");
  const [pay, setPay] = useState<"now" | "when_fitted">("now");
  const line = labour.find((l) => l.id === labourId) ?? null;
  const laterNum = Number(later.replace(",", "."));
  const doneNow = line && Number.isFinite(laterNum) ? Math.round((line.hours - laterNum) * 10) / 10 : null;
  const needsOwnerWords = !mayDecide ? "It goes to the owner for approval." : pay === "when_fitted" ? "\"Pays when fitted\" goes to the owner for approval." : "It applies at once.";
  return (
    <div className="rounded-md border border-line p-3 flex flex-col gap-3" data-back-order-part={c.partId}>
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-bold uppercase"><Words text={c.name} /></p>
        <p className="text-xs text-muted"><Words text={`${c.orderWords}${c.lpo ? ` · ${c.lpo}` : ""} · expected ${day(c.expected)}`} /></p>
        <p className="text-xs text-muted" data-supplier-paid><Words text={c.supplierPaid} /></p>
        {c.line ? <p className="text-xs" data-back-order-line><Words text={`Charged on ${c.line.number}: ${aed(c.line.amount)} before VAT`} /></p> : <p className="text-xs text-red font-semibold">No approved line charges this part: revise the quotation first.</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup">
        <button type="button" className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold text-left ${choice === "coming" ? "border-ink bg-ink text-white" : "border-line bg-white"}`} onClick={() => setChoice("coming")} data-back-order-choice="coming">Still coming for this visit</button>
        <button type="button" disabled={!c.line} className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold text-left disabled:opacity-50 ${choice === "later" ? "border-ink bg-ink text-white" : "border-line bg-white"}`} onClick={() => setChoice("later")} data-back-order-choice="later">Back order - fit on a later visit</button>
      </div>
      {choice === "coming" ? <p className="text-xs text-muted">The part keeps blocking Work complete until it is handed to the technician.</p> : null}
      {choice === "later" && c.line ? (
        <ActionForm action={action} className="flex flex-col gap-3">
          {() => (
            <>
              <input type="hidden" name="part_id" value={c.partId} />
              <input type="hidden" name="pay_mode" value={pay} />
              <Textarea name="reason" rows={2} required minLength={5} placeholder="Why it is fitted later (for example: 60-day special order, the car cannot wait)" data-back-order-reason />
              {labour.length ? (
                <div className="flex flex-col gap-2 rounded-md bg-surface p-3">
                  <label className="text-sm font-semibold" htmlFor={`bo-lab-${c.partId}`}>Labour shared with finished work (split it)</label>
                  <select id={`bo-lab-${c.partId}`} name="labour_line_id" value={labourId} onChange={(e) => setLabourId(e.target.value)} className="min-h-11 rounded-md border border-line bg-white px-3 text-sm" data-back-order-labour>
                    <option value="">No labour moves</option>
                    {labour.map((l) => <option key={l.id} value={l.id}>{l.title} · {l.hours.toFixed(1)} h ({l.number})</option>)}
                  </select>
                  {line ? (
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="font-semibold">Hours for later</span>
                        <input name="hours_later" inputMode="decimal" value={later} onChange={(e) => setLater(e.target.value)} placeholder={`0 to ${line.hours.toFixed(1)}`} className={controlClass} style={{ width: "8rem" }} required data-back-order-hours />
                      </label>
                      <p className="text-sm pb-2" data-back-order-split>
                        {doneNow !== null && laterNum >= 0 && laterNum <= line.hours ? <>Done now: <b>{doneNow.toFixed(1)} h</b> stays on this job · later: <b>{laterNum.toFixed(1)} h</b></> : <span className="text-muted">The line has {line.hours.toFixed(1)} h.</span>}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">The customer pays for the part</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button type="button" className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold text-left ${pay === "now" ? "border-ink bg-ink text-white" : "border-line bg-white"}`} onClick={() => setPay("now")} data-back-order-pay="now">Customer pays for the part now</button>
                  <button type="button" className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold text-left ${pay === "when_fitted" ? "border-ink bg-ink text-white" : "border-line bg-white"}`} onClick={() => setPay("when_fitted")} data-back-order-pay="when_fitted">Pays when fitted (needs the owner)</button>
                </div>
              </div>
              <p className="text-xs text-muted">A linked job is made for the later visit (&quot;Waiting for part - car not here&quot;) with the part, its LPO and the labour above, already approved by the customer. This visit&apos;s invoice covers only the work done. {needsOwnerWords}</p>
              <Button type="submit" size="lg" data-back-order-save>{mayDecide && pay === "now" ? "Put on back order" : "Ask the owner for the back order"}</Button>
            </>
          )}
        </ActionForm>
      ) : null}
    </div>
  );
}
