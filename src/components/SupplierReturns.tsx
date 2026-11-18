"use client";

import { useActionState, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Input } from "@/components/ui";
import { MoneyDate } from "@/components/MoneyDate";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { RETURN_REASONS } from "@/lib/supplier-return-rules";
import { newUuid } from "@/lib/uuid";
import type { ReturnAnswer } from "@/app/(app)/parts/supplier-return-actions";
import { readInvoiceScanAction } from "@/app/(app)/supplier-invoices/scan-actions";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (t: string) => { const n = Number(t.replace(/,/g, "").trim()); return t.trim() && Number.isFinite(n) ? n : null; };

function Window({ title, onClose, children, hook }: { title: string; onClose: () => void; children: React.ReactNode; hook: string }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} {...{ [hook]: "" }}>
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-card bg-white p-5">
        <div className="flex items-center justify-between gap-2"><span className="text-lg font-extrabold">{title}</span><Button type="button" tone="ghost" size="md" onClick={onClose} data-window-close>Close</Button></div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export type ReturnPart = { id: string; name: string; received: number; unitCost: number; withTech: boolean; window: { blocked: boolean; warn: boolean; words: string | null } };

/**
 * "Return to supplier" (19 November 2026, Section 4): ONE window on the LPO for the parts desk - the received parts
 * going back (how many each), why (no reason picked for you), and whether the supplier sends a replacement: one new
 * line on this LPO covering them, with its price when known (dearer = the "cost went up" approval).
 */
export function ReturnToSupplier({ parts, action, isOwner }: { parts: ReturnPart[]; action: (s: ReturnAnswer, f: FormData) => Promise<ReturnAnswer>; isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, null);
  const [ticked, setTicked] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<string>("");
  const [rep, setRep] = useState<"" | "yes" | "no">("");
  const [repPrice, setRepPrice] = useState("");
  const back = useMemo(() => parts.filter((p) => ticked[p.id] !== undefined).reduce((a, p) => a + p.unitCost * (num(ticked[p.id] ?? "") ?? 0), 0), [parts, ticked]);
  const price = num(repPrice);
  if (!parts.length) return null;
  return (
    <>
      <Button type="button" tone="secondary" size="md" onClick={() => setOpen(true)} data-return-open>Return to supplier</Button>
      {open ? (
        <Window title="Return to supplier" onClose={() => setOpen(false)} hook="data-return-window">
          {state?.words ? (
            <>
              <p className="rounded-control border border-green bg-green-soft px-3 py-2 text-sm font-bold text-green-text" data-return-done>{state.words}</p>
              <div><Button type="button" size="md" onClick={() => { setOpen(false); window.location.reload(); }} data-return-ok>OK</Button></div>
            </>
          ) : (
            <form action={formAction} className="flex flex-col gap-3">
              <span className="text-xs font-semibold uppercase text-muted">Which parts go back (received on this LPO)</span>
              <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
                {parts.map((p) => {
                  const on = ticked[p.id] !== undefined;
                  const blocked = p.withTech || (p.window.blocked && !isOwner);
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-return-part={p.name}>
                      <label className="flex min-h-11 flex-1 items-center gap-2">
                        <input type="checkbox" name="part" value={p.id} checked={on} disabled={blocked} onChange={(e) => setTicked((t) => { const n = { ...t }; if (e.target.checked) n[p.id] = String(p.received); else delete n[p.id]; return n; })} className="h-5 w-5 accent-ink" data-return-tick={p.name} />
                        <span className="font-semibold uppercase">{p.name}</span>
                        <span className="text-muted">received {p.received} · {aed(p.unitCost)} each</span>
                      </label>
                      {on ? <label className="flex items-center gap-1 text-xs font-semibold">How many<Input name={`qty_${p.id}`} inputMode="decimal" value={ticked[p.id]} onChange={(e) => setTicked((t) => ({ ...t, [p.id]: e.target.value }))} style={{ width: "5rem" }} data-return-qty={p.name} /></label> : null}
                      {p.withTech ? <span className="basis-full text-xs font-bold text-red" data-return-with-tech>With the technician: he hands it back first (Parts → Returns and leftovers).</span> : null}
                      {p.window.words ? <span className={`basis-full text-xs font-bold ${p.window.blocked ? "text-red" : p.window.warn ? "text-amber-text" : "text-muted"}`} data-return-window-words>{p.window.words}</span> : null}
                    </li>
                  );
                })}
              </ul>
              <span className="text-xs font-semibold uppercase text-muted">Why</span>
              <div className="flex flex-wrap gap-2" role="radiogroup">
                {RETURN_REASONS.map((r) => (
                  <label key={r.key} className={`inline-flex min-h-11 cursor-pointer items-center rounded-control border-2 px-3 text-sm font-bold ${reason === r.key ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>
                    <input type="radio" name="reason" value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} className="sr-only" data-return-reason={r.key} />{r.label}
                  </label>
                ))}
              </div>
              <Input name="note" placeholder="A note for the supplier and accounts (optional)" data-return-note />
              <span className="text-xs font-semibold uppercase text-muted">Does the supplier send a replacement?</span>
              <div className="flex flex-wrap gap-2">
                {(["yes", "no"] as const).map((v) => (
                  <label key={v} className={`inline-flex min-h-11 cursor-pointer items-center rounded-control border-2 px-3 text-sm font-bold ${rep === v ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>
                    <input type="radio" name="replacement" value={v} checked={rep === v} onChange={() => setRep(v)} className="sr-only" data-return-replacement={v} />{v === "yes" ? "Yes – a new line on this LPO" : "No – a credit only"}
                  </label>
                ))}
              </div>
              {rep === "yes" ? (
                <div className="flex flex-wrap items-end gap-2 rounded-control border border-line bg-white p-3">
                  <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold uppercase text-muted">The replacement<Input name="replacement_name" defaultValue={parts.find((p) => ticked[p.id] !== undefined)?.name ?? ""} data-return-replacement-name data-spell="" /></label>
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase text-muted">Its price before VAT (if known)<Input name="replacement_price" inputMode="decimal" value={repPrice} onChange={(e) => setRepPrice(e.target.value)} style={{ width: "9rem" }} data-return-replacement-price /></label>
                  <span className="basis-full text-xs text-muted" data-return-replacement-words>Going back: {aed(back)}.{price !== null && price > back + 0.004 ? ` The replacement costs ${aed(price - back).replace("AED ", "AED +")} more: it goes for approval (cost went up).` : ""}</span>
                </div>
              ) : null}
              {state?.error ? <p className="text-sm font-bold text-red" data-return-error>{state.error}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="md" disabled={pending || !Object.keys(ticked).length || !reason || !rep} data-return-save>{pending ? "Saving…" : "Send back"}</Button>
              </div>
            </form>
          )}
        </Window>
      ) : null}
    </>
  );
}

export type CreditInvoiceOption = { poId: string; jobId: string | null; label: string; chargesVat: boolean; parts: { id: string; name: string; qty: number; unit: number; state: string }[] };

/**
 * "+ Enter a credit note" (accounts and the owner): the invoice it refers to, the parts on it with their amounts before
 * VAT, the number, date and VAT, the scan (the same reader as the supplier invoices). A part never started as a return
 * becomes one with it. The credit lowers what we owe; on a paid invoice it stays as credit with that supplier.
 */
export function CreditNoteEntry({ invoices, action, presetPoId = null, label = "+ Enter a credit note" }: { invoices: CreditInvoiceOption[]; action: (s: ReturnAnswer, f: FormData) => Promise<ReturnAnswer>; presetPoId?: string | null; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, null);
  const [poId, setPoId] = useState<string>(presetPoId ?? "");
  const [ticked, setTicked] = useState<Record<string, string>>({});
  const [number, setNumber] = useState("");
  const [date, setDate] = useState("");
  const [vatTyped, setVatTyped] = useState<string | null>(null);
  const [scanRef] = useState(() => newUuid());
  const [files, setFiles] = useState<JobFile[]>([]);
  const [reading, setReading] = useState<string | null>(null);
  const [todayDay] = useState(() => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10));
  const inv = invoices.find((i) => i.poId === poId) ?? null;
  const net = Object.entries(ticked).reduce((a, [, v]) => a + (num(v) ?? 0), 0);
  const vatAuto = inv?.chargesVat ? Math.round(net * 5) / 100 : 0;
  const vat = vatTyped !== null ? (num(vatTyped) ?? 0) : vatAuto;
  const read = async () => {
    setReading("Reading…");
    const r = await readInvoiceScanAction(scanRef);
    if (r.error || !r.facts) return setReading(r.error ?? "Nothing could be read: type the figures.");
    if (r.facts.number) setNumber(r.facts.number);
    if (r.facts.date) setDate(r.facts.date);
    if (r.facts.vat !== null && r.facts.vat !== undefined) setVatTyped(String(r.facts.vat));
    setReading(`Read from the scan${r.facts.beforeVat !== null ? `: before VAT ${aed(r.facts.beforeVat)}` : ""}${r.facts.net !== null ? `, total ${aed(r.facts.net)}` : ""}. Check every figure.`);
  };
  return (
    <>
      <Button type="button" tone="secondary" size="md" onClick={() => setOpen(true)} data-credit-note-open>{label}</Button>
      {open ? (
        <Window title="Enter a supplier credit note" onClose={() => setOpen(false)} hook="data-credit-note-window">
          {state?.words ? (
            <>
              <p className="rounded-control border border-green bg-green-soft px-3 py-2 text-sm font-bold text-green-text" data-credit-note-done>{state.words}</p>
              <div><Button type="button" size="md" onClick={() => { setOpen(false); window.location.reload(); }} data-credit-note-ok>OK</Button></div>
            </>
          ) : (
            <form action={formAction} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase text-muted">The invoice it refers to
                <select name="po_id" value={poId} onChange={(e) => { setPoId(e.target.value); setTicked({}); }} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-sm normal-case text-ink" data-credit-note-invoice required>
                  <option value="">Pick the supplier&apos;s invoice…</option>
                  {invoices.map((i) => <option key={i.poId} value={i.poId}>{i.label}</option>)}
                </select>
              </label>
              {inv ? (
                <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
                  {inv.parts.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-credit-note-part={p.name}>
                      <label className="flex min-h-11 flex-1 items-center gap-2">
                        <input type="checkbox" name="part" value={p.id} checked={ticked[p.id] !== undefined} onChange={(e) => setTicked((t) => { const n = { ...t }; if (e.target.checked) n[p.id] = (p.unit * p.qty).toFixed(2); else delete n[p.id]; return n; })} className="h-5 w-5 accent-ink" data-credit-note-tick={p.name} />
                        <span className="font-semibold uppercase">{p.name}</span>
                        <span className="text-muted">× {p.qty} · {aed(p.unit)} each{p.state ? ` · ${p.state}` : ""}</span>
                      </label>
                      {ticked[p.id] !== undefined ? <label className="flex items-center gap-1 text-xs font-semibold">Before VAT<Input name={`amount_${p.id}`} inputMode="decimal" value={ticked[p.id]} onChange={(e) => setTicked((t) => ({ ...t, [p.id]: e.target.value }))} style={{ width: "7rem" }} data-credit-note-amount={p.name} /></label> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase text-muted">Credit note number<Input name="number" value={number} onChange={(e) => setNumber(e.target.value)} required style={{ width: "10rem" }} data-credit-note-number /></label>
                <MoneyDate name="date" label="Credit note date" value={date} onChange={setDate} max={todayDay} hook="data-credit-note-date" />
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase text-muted">VAT{inv && !inv.chargesVat ? " (supplier charges none)" : " 5%"}<Input name="vat" inputMode="decimal" value={vatTyped ?? vatAuto.toFixed(2)} onChange={(e) => setVatTyped(e.target.value)} style={{ width: "7rem" }} data-credit-note-vat /></label>
              </div>
              <p className="text-sm font-bold" data-credit-note-total>Before VAT {aed(net)} + VAT {aed(vat).replace("AED ", "")} = {aed(net + vat)}</p>
              {inv ? (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">The credit note&apos;s scan (photo or PDF)</span>
                  <JobFileUpload jobId={inv.jobId ?? "nocar"} kind="supplier_invoice" refId={scanRef} files={files} accept="pdf" label="Scan / attach" compact removable onAdded={(f) => setFiles((s) => [...s, f])} onRemoved={(f) => setFiles((s) => s.filter((x) => x.id !== f.id))} />
                  <input type="hidden" name="scan_path" value={files[0]?.path ?? ""} />
                  {files.length ? <span className="flex flex-wrap items-center gap-2"><Button type="button" tone="secondary" size="md" onClick={() => void read()} data-credit-note-read>Read the scan</Button>{reading ? <span className="text-xs font-semibold text-muted" data-credit-note-read-words>{reading}</span> : null}</span> : null}
                </div>
              ) : null}
              {state?.error ? <p className="text-sm font-bold text-red" data-credit-note-error>{state.error}</p> : null}
              <div><Button type="submit" size="md" disabled={pending || !inv || !Object.keys(ticked).length || !number.trim() || !date} data-credit-note-save>{pending ? "Saving…" : "Save the credit note"}</Button></div>
            </form>
          )}
        </Window>
      ) : null}
    </>
  );
}

/** A supplier's return window (Parts > Suppliers): days to return, days for the credit note, no returns on electrical items. */
export function ReturnRulesBox({ rules, action }: { rules: { returnDays: number | null; creditDays: number | null; noElectrical: boolean }; action: (s: ReturnAnswer, f: FormData) => Promise<ReturnAnswer> }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-control border border-line bg-white p-3" data-return-rules>
      <span className="basis-full text-xs font-semibold uppercase text-muted">Returns to this supplier</span>
      <label className="flex flex-col gap-1 text-xs font-semibold">Days to return a part<Input name="return_days" inputMode="numeric" defaultValue={rules.returnDays ?? ""} placeholder="no limit" style={{ width: "7rem" }} data-return-days /></label>
      <label className="flex flex-col gap-1 text-xs font-semibold">Days for their credit note<Input name="credit_days" inputMode="numeric" defaultValue={rules.creditDays ?? ""} placeholder="no limit" style={{ width: "7rem" }} data-credit-days /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="no_electrical" value="1" defaultChecked={rules.noElectrical} className="h-5 w-5 accent-ink" data-no-electrical />No returns on electrical items and batteries</label>
      <Button type="submit" size="md" tone="secondary" disabled={pending} data-return-rules-save>{pending ? "Saving…" : "Save"}</Button>
      {state?.words ? <span className="text-sm font-bold text-green-text" data-return-rules-saved>{state.words}</span> : null}
      {state?.error ? <span className="text-sm font-bold text-red">{state.error}</span> : null}
    </form>
  );
}
