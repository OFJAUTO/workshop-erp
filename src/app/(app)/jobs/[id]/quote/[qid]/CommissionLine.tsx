"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { aed } from "@/lib/quotes";
import { decideCommission, saveCommission } from "@/app/(app)/quotes/actions";

export type CommissionState = {
  to: string | null;
  kind: "aed" | "percent" | null;
  value: number | null;
  status: "pending" | "approved" | "declined" | null;
  decisionNote: string | null;
};

/**
 * The one Commission line of the internal box, directly under Recovery cost: "+ Add" opens the fields right there
 * (who, AED or %); once added it reads "Commission · Ahmed (5%): AED 2,833" with Edit and Remove. Anyone but the
 * owner adding or changing one waits in amber for the owner, who approves, declines (with a note) or changes the
 * amount; the owner's own are approved at once. Never shown to the customer.
 */
export function CommissionLine({ quotationId, commission, people, isOwner, net, disabled, onLocal }: {
  quotationId: string;
  commission: CommissionState;
  people: string[];
  isOwner: boolean;
  /** The quotation total before VAT, for the live amount of a percentage. */
  net: number;
  disabled: boolean;
  /** Tells the editor at once (before the save answers), so the internal box moves with no refresh; called again with the old values if the save fails. */
  onLocal?: (c: { to: string | null; kind: "aed" | "percent" | null; value: number | null; status: CommissionState["status"] }) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [who, setWho] = useState(commission.to ?? "");
  const [kind, setKind] = useState<"aed" | "percent">(commission.kind ?? "aed");
  const [value, setValue] = useState(commission.value === null || commission.value === undefined ? "" : String(commission.value));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const amountOf = (k: "aed" | "percent", v: number) => (k === "percent" ? net * (Math.min(100, Math.max(0, v)) / 100) : Math.max(0, v));
  // The internal box moves at once: the editor is told the new values before the save answers, and told
  // the old ones back if the server refuses.
  const revert = { to: commission.to, kind: commission.kind, value: commission.value, status: commission.status };
  const run = (fn: () => Promise<{ error?: string } | void>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r && "error" in r && r.error) {
        setError(r.error);
        onLocal?.(revert);
      } else {
        setEditing(false);
        setDeclining(false);
        router.refresh();
      }
    });
  const save = () => {
    const fd = new FormData();
    fd.set("to", who.trim());
    fd.set("kind", kind);
    fd.set("value", value);
    onLocal?.({ to: who.trim() || null, kind, value: Number(value) || null, status: who.trim() ? (isOwner ? "approved" : "pending") : null });
    run(() => saveCommission(quotationId, fd));
  };
  const decide = (decision: "approve" | "decline") => {
    const fd = new FormData();
    fd.set("decision", decision);
    if (note.trim()) fd.set("note", note.trim());
    onLocal?.(decision === "approve" ? { ...revert, status: "approved" } : { to: null, kind: null, value: null, status: "declined" });
    run(() => decideCommission(quotationId, fd));
  };

  const set = !!commission.to && commission.status !== "declined";
  const summary = set ? `${commission.to}${commission.kind === "percent" ? ` (${commission.value}%)` : ""}` : null;
  const amount = set ? amountOf(commission.kind ?? "aed", Number(commission.value) || 0) : 0;

  const fields = (
    <div className="col-span-2 flex flex-col gap-1.5 rounded-control border border-line bg-white p-2" data-commission-fields>
      <div className="flex flex-wrap items-center gap-1.5">
        {people.map((p) => (
          <button key={p} type="button" disabled={disabled || pending} onClick={() => setWho(p)} aria-pressed={who === p} className={`min-h-8 rounded-control border px-2.5 text-[11px] font-bold ${who === p ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`} data-commission-person>{who === p ? "✓ " : ""}{p}</button>
        ))}
        <Input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Who gets it?" aria-label="Commission to" className="min-h-8 w-32 text-xs" textCase="title" data-commission-who />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="0" aria-label="Commission amount" className="min-h-8 text-right text-xs" style={{ width: "5.5rem" }} data-commission-amount />
        <span className="inline-flex overflow-hidden rounded-control border border-line-strong">
          <button type="button" onClick={() => setKind("aed")} aria-pressed={kind === "aed"} className={`min-h-8 px-2.5 text-[11px] font-bold ${kind === "aed" ? "bg-ink text-white" : "bg-white"}`}>AED</button>
          <button type="button" onClick={() => setKind("percent")} aria-pressed={kind === "percent"} className={`min-h-8 px-2.5 text-[11px] font-bold ${kind === "percent" ? "bg-ink text-white" : "bg-white"}`}>% of total before VAT</button>
        </span>
        {who.trim() && Number(value) > 0 ? <span className="text-[11px] font-semibold">= {aed(amountOf(kind, Number(value) || 0))}</span> : null}
        <Button type="button" size="md" disabled={pending || !who.trim() || !(Number(value) > 0)} onClick={save} data-commission-save>{pending ? "…" : isOwner ? "Save" : "Save (owner approves)"}</Button>
        <Button type="button" tone="ghost" size="md" onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
      </div>
      {error ? <span className="text-[11px] font-semibold text-red">{error}</span> : null}
    </div>
  );

  return (
    <>
      <dt className="text-muted" data-commission-line>
        Commission{summary ? ` · ${summary}` : ""}
        {set && commission.status === "pending" ? <span className="ml-1 font-semibold text-amber" data-commission-pending>Pending owner approval · already counted in the costs</span> : null}
      </dt>
      <dd className="text-right">
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
          {set ? <span className={commission.status === "pending" ? "text-amber font-semibold" : ""}>{aed(amount)}</span> : <span>{aed(0)}</span>}
          {!disabled && !set && !editing ? <button type="button" onClick={() => { setEditing(true); setWho(""); setKind("aed"); setValue(""); }} className="min-h-7 rounded-control border border-line-strong bg-white px-2 text-[11px] font-bold" data-commission-add>+ Add</button> : null}
          {!disabled && set && !editing ? (
            <>
              <button type="button" onClick={() => { setEditing(true); setWho(commission.to ?? ""); setKind(commission.kind ?? "aed"); setValue(commission.value === null ? "" : String(commission.value)); }} className="min-h-7 rounded-control border border-line-strong bg-white px-2 text-[11px] font-bold" data-commission-edit>Edit</button>
              <button type="button" disabled={pending} onClick={() => { const fd = new FormData(); fd.set("to", ""); onLocal?.({ to: null, kind: null, value: null, status: null }); run(() => saveCommission(quotationId, fd)); }} className="min-h-7 px-1.5 text-[11px] font-bold text-red" data-commission-remove>Remove</button>
            </>
          ) : null}
        </span>
      </dd>
      {editing ? fields : null}
      {set && commission.status === "pending" && isOwner && !editing ? (
        <div className="col-span-2 flex flex-wrap items-center gap-2 rounded-control border border-amber-bar bg-amber-soft p-2" data-commission-decide>
          <span className="text-[11px] font-semibold">Commission for {commission.to}, {aed(amount)}: your call.</span>
          <Button type="button" size="md" disabled={pending} onClick={() => decide("approve")} data-commission-approve>Approve</Button>
          <Button type="button" tone="secondary" size="md" onClick={() => { setEditing(true); setWho(commission.to ?? ""); setKind(commission.kind ?? "aed"); setValue(commission.value === null ? "" : String(commission.value)); }} data-commission-change>Change amount</Button>
          {declining ? (
            <span className="inline-flex items-center gap-1.5">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not?" aria-label="Decline note" className="min-h-8 w-44 text-xs" textCase="sentence" data-commission-decline-note />
              <Button type="button" tone="secondary" size="md" disabled={pending} onClick={() => decide("decline")} data-commission-decline-send>Decline</Button>
            </span>
          ) : (
            <Button type="button" tone="ghost" size="md" onClick={() => setDeclining(true)} data-commission-decline>Decline</Button>
          )}
          {error ? <span className="text-[11px] font-semibold text-red">{error}</span> : null}
        </div>
      ) : null}
      {commission.status === "declined" && !editing ? (
        <div className="col-span-2 text-[11px] font-semibold text-red" data-commission-declined>
          Commission declined by the owner{commission.decisionNote ? `: ${commission.decisionNote}` : ""}.
          {!disabled ? <button type="button" onClick={() => { setEditing(true); setWho(""); setKind("aed"); setValue(""); }} className="ml-2 underline underline-offset-4" data-commission-add>+ Add again</button> : null}
        </div>
      ) : null}
    </>
  );
}
