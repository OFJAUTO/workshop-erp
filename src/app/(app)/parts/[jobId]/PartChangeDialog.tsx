"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { reloadIfStale } from "@/lib/app-version";
import { PART_TYPE_LABELS } from "@/lib/quotes";
import { absorbOf, changedPhrases, needsOwner, profitOf, type PartFacts, type PriceChoice } from "@/lib/part-change-rules";
import { changePartAction, linkReplacementAction, partChangePreviewAction } from "../part-change-actions";

const DAY_CHOICES: { key: string; label: string; days: number | null; inStock: boolean }[] = [
  { key: "stock", label: "In stock", days: null, inStock: true },
  { key: "0", label: "Same day", days: 0, inStock: false },
  { key: "1", label: "Next day", days: 1, inStock: false },
  { key: "2", label: "2 days", days: 2, inStock: false },
  { key: "3", label: "3 days", days: 3, inStock: false },
  { key: "7", label: "1 week", days: 7, inStock: false },
];
const REASONS = ["Better price", "Faster delivery", "Supplier has none", "Supplier price changed", "Wrong part number"];
const aed = (n: number | null) => (n === null ? "—" : `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const box = "min-h-11 w-full rounded-control border border-line-strong bg-white px-3 text-sm";

/**
 * THE window "Change supplier / price…" (13 November 2026, Section 3): the parts desk or the owner changes a part's
 * supplier, cost, delivery time, part number or type IN PLACE, with a reason. It shows the line's profit now and after
 * before saving; a dearer part or another type asks how the customer's approved price goes (keep it, we absorb the
 * difference / revise the quotation) and waits for the owner. The history of the part is at the top.
 * Portalled to the body: the row behind it may be greyed.
 */
export function PartChangeDialog({ jobId, partId, name, isOwner: ownerProp = false, suppliers, types, history, onClose, onDone }: { jobId: string; partId: string; name: string; isOwner?: boolean; suppliers: string[]; types: string[]; history: { words: string; status: string; at: string }[]; onClose: () => void; onDone: () => void }) {
  const [before, setBefore] = useState<PartFacts | null>(null);
  const [sellEach, setSellEach] = useState<number | null>(null);
  const [approved, setApproved] = useState(false);
  const [quote, setQuote] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(ownerProp);
  const [supplier, setSupplier] = useState("");
  const [cost, setCost] = useState("");
  const [day, setDay] = useState("stock");
  const [pn, setPn] = useState("");
  const [noPn, setNoPn] = useState(false);
  const [type, setType] = useState("");
  const [reason, setReason] = useState("");
  const [choice, setChoice] = useState<PriceChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void partChangePreviewAction(jobId, partId).then((p) => {
      if (!alive || !p) return;
      setBefore(p.before);
      setSellEach(p.sellEach);
      setApproved(p.approved);
      setQuote(p.quote);
      setIsOwner(p.isOwner);
      setSupplier(p.before.supplier ?? "");
      setCost(p.before.cost === null ? "" : String(p.before.cost));
      setDay(p.before.availability === "in_stock" ? "stock" : p.before.days === null ? "2" : String(DAY_CHOICES.find((d) => d.days === p.before.days)?.key ?? "2"));
      setNoPn(String(p.before.partNumber ?? "").toUpperCase() === "NO NUMBER");
      setPn(String(p.before.partNumber ?? "").toUpperCase() === "NO NUMBER" ? "" : p.before.partNumber ?? "");
      setType(p.before.partType ?? "");
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { alive = false; window.removeEventListener("keydown", onKey); };
  }, [jobId, partId, onClose]);

  const d = DAY_CHOICES.find((x) => x.key === day) ?? DAY_CHOICES[0];
  const after: PartFacts | null = before ? { supplier: supplier.trim() || null, cost: cost.trim() === "" ? null : Number(cost.replace(/,/g, "")), days: d.days, availability: d.inStock ? "in_stock" : "to_order", partNumber: noPn ? "NO NUMBER" : pn.trim().toUpperCase() || null, partType: type || null, quantity: before.quantity } : null;
  const phrases = before && after ? changedPhrases(before, after) : [];
  const owner = before && after ? needsOwner(before, after) : false;
  const askChoice = approved && owner;
  const profitNow = before ? profitOf(sellEach, before) : null;
  const profitAfter = after ? profitOf(sellEach, after) : null;
  const absorb = before && after ? absorbOf(before, after) : 0;
  const ready = !!after && phrases.length > 0 && reason.trim().length >= 3 && !!supplier.trim() && after.cost !== null && after.cost > 0 && (!askChoice || !!choice) && !busy;

  async function save() {
    if (!after) return;
    setBusy(true);
    setError(null);
    try {
      const r = await changePartAction(jobId, partId, { supplier: supplier.trim(), cost: after.cost ?? 0, days: d.days, inStock: d.inStock, partNumber: after.partNumber, partType: type || null, reason: reason.trim(), choice: askChoice ? choice : null });
      if (r.error) setError(r.error);
      else {
        setDone(r.words ?? "Changed.");
        onDone();
      }
    } catch (e) {
      if (!reloadIfStale(e)) setError("No connection – nothing was changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const supplierList = Array.from(new Set([...(before?.supplier ? [before.supplier] : []), ...suppliers])).filter(Boolean);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div className="flex w-full max-w-lg max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-y-auto rounded-card bg-white p-5" onClick={(e) => e.stopPropagation()} data-part-change-dialog>
        <span className="text-lg font-extrabold">Change supplier / price · {name.toUpperCase()}</span>
        {history.length ? (
          <div className="flex flex-col gap-1 rounded-control bg-chip p-2 text-xs" data-part-change-history>
            {history.map((h, i) => <span key={i}>{h.status === "pending" ? "Waiting for the owner: " : h.status === "refused" ? "Refused: " : ""}{h.words}</span>)}
          </div>
        ) : null}
        {done ? (
          <>
            <p className="rounded-control bg-green-soft px-3 py-2 text-sm font-semibold text-green-text" data-part-change-done>{done}</p>
            <Button type="button" onClick={onClose} data-part-change-close>Close</Button>
          </>
        ) : !before ? (
          <p className="text-sm text-muted">Loading the part…</p>
        ) : (
          <>
            <p className="text-xs text-muted">The part keeps its place on the quotation, the job and the technician&apos;s request. {quote ? `It is on ${quote}${approved ? ", approved by the customer" : ""}.` : ""}</p>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Supplier
              <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={box} data-change-supplier>
                <option value="">Choose…</option>
                {supplierList.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Cost each (before VAT)
                <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className={box} data-change-cost />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Type
                <select value={type} onChange={(e) => setType(e.target.value)} className={box} data-change-type>
                  <option value="">Not set</option>
                  {Array.from(new Set([...(types.length ? types : Object.keys(PART_TYPE_LABELS)), ...(before.partType ? [before.partType] : [])])).map((t) => <option key={t} value={t}>{PART_TYPE_LABELS[t] ?? t}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Delivery</span>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1.5" data-change-days>
                {DAY_CHOICES.map((x) => <button key={x.key} type="button" aria-pressed={day === x.key} onClick={() => setDay(x.key)} className={`min-h-11 rounded-control border px-2 text-sm font-semibold ${day === x.key ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-change-day={x.key}>{x.label}</button>)}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Part number</span>
              <div className="flex flex-wrap items-center gap-2">
                <input value={noPn ? "" : pn} disabled={noPn} onChange={(e) => setPn(e.target.value)} placeholder="Part number" className={`${box} min-w-0 flex-1 uppercase disabled:bg-chip`} data-change-pn />
                <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={noPn} onChange={(e) => setNoPn(e.target.checked)} className="h-5 w-5 accent-ink" data-change-no-pn />No part number yet</label>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Why (the history keeps it)</span>
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${reason === r ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>{r}</button>)}
              </div>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type the reason" className={box} data-change-reason data-spell="" />
            </div>
            <div className="flex flex-col gap-0.5 rounded-control border border-line p-3 text-sm" data-change-profit>
              <span className="font-semibold">{phrases.length ? phrases.join(" · ") : "Nothing changed yet."}</span>
              {sellEach !== null ? <span>Customer pays {aed(sellEach)} each · profit on this line <b>{aed(profitNow)}</b> → <b className={profitAfter !== null && profitNow !== null && profitAfter < profitNow ? "text-red" : "text-green-text"} data-change-profit-after>{aed(profitAfter)}</b></span> : <span className="text-muted">Not on a quotation yet: the advisor prices it.</span>}
              {owner ? <span className="font-semibold text-amber-text" data-change-needs-owner>{after && before && (after.cost ?? 0) > (before.cost ?? 0) ? "The cost goes up" : "The part type changes"}: the owner approves it before it is applied.</span> : phrases.length ? <span className="text-green-text">Cost down or the same, same type: applied at once (logged).</span> : null}
            </div>
            {askChoice ? (
              <div className="flex flex-col gap-1.5" data-change-choice>
                <span className="text-xs font-semibold text-muted">The customer already approved this part. The approved quotation stays locked:</span>
                <button type="button" aria-pressed={choice === "keep"} onClick={() => setChoice("keep")} className={`min-h-11 rounded-control border px-3 text-left text-sm font-semibold ${choice === "keep" ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-change-keep>Keep the customer&apos;s price (we absorb {aed(absorb)})</button>
                <button type="button" aria-pressed={choice === "revise"} onClick={() => setChoice("revise")} className={`min-h-11 rounded-control border px-3 text-left text-sm font-semibold ${choice === "revise" ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-change-revise>Revise the quote (the customer approves the new price)</button>
              </div>
            ) : null}
            {error ? <p className="rounded-control bg-red-soft px-3 py-2 text-sm font-semibold text-red" role="alert" data-part-change-error>{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={!ready} onClick={() => void save()} data-part-change-save>{busy ? "Saving…" : owner && !isOwner ? "Send to the owner" : "Save the change"}</Button>
              <Button type="button" tone="secondary" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * "This replaces…" (13 November 2026, Section 3, the repair): a part that was removed and added again before the
 * change window existed is linked to the removed approved part it replaced. It inherits that part's quotation line and
 * the customer's approval; the customer is never asked again while the price stays the same.
 */
export function RelinkDialog({ jobId, partId, name, targets, onClose, onDone }: { jobId: string; partId: string; name: string; targets: { id: string; words: string }[]; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  async function link(oldId: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await linkReplacementAction(jobId, partId, oldId);
      if (r.error) setError(r.error);
      else {
        setDone(r.words ?? "Linked.");
        onDone();
      }
    } catch (e) {
      if (!reloadIfStale(e)) setError("No connection – nothing was changed. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div className="flex w-full max-w-lg max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-y-auto rounded-card bg-white p-5" onClick={(e) => e.stopPropagation()} data-relink-dialog>
        <span className="text-lg font-extrabold">{name.toUpperCase()} replaces…</span>
        {done ? (
          <>
            <p className="rounded-control bg-green-soft px-3 py-2 text-sm font-semibold text-green-text" data-relink-done>{done}</p>
            <Button type="button" onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted">Pick the part that was removed and added again as this one. It keeps the customer&apos;s approval and its place on the quotation.</p>
            <div className="flex flex-col gap-1.5">
              {targets.map((t) => <button key={t.id} type="button" disabled={busy} onClick={() => void link(t.id)} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-left text-sm font-semibold hover:border-ink" data-relink-target={t.id}>{t.words}</button>)}
            </div>
            {error ? <p className="rounded-control bg-red-soft px-3 py-2 text-sm font-semibold text-red" role="alert">{error}</p> : null}
            <Button type="button" tone="secondary" onClick={onClose}>Cancel</Button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
