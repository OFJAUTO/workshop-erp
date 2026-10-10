"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Field, Input, Notice } from "@/components/ui";
import type { BalanceInfo } from "./GateOutForm";

type Item = { id: string; label: string; collected: boolean };

/** Loose items go home one by one: tick what leaves now, write who took it. The job closes when the last one goes. */
export function CollectItemsForm({ action, items, canApproveRelease, balance }: { action: FormAction; items: Item[]; canApproveRelease: boolean; balance: BalanceInfo }) {
  const left = items.filter((i) => !i.collected);
  const [ticked, setTicked] = useState<Record<string, boolean>>(Object.fromEntries(left.map((i) => [i.id, true])));
  const count = left.filter((i) => ticked[i.id]).length;
  const blocked = balance.state === "no_invoice" || balance.balance > 0;
  const blockedText = balance.state === "no_invoice" ? "No invoice has been issued for this job." : `Balance due AED ${balance.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })}${balance.invoiceNumber ? ` on ${balance.invoiceNumber}` : ""}.`;
  return (
    <ActionForm action={action}>
      {(v) => (
        <>
          <Field label="Which items leave now?">
            <ul className="flex flex-col gap-2">
              {items.map((it) => (
                <li key={it.id} className={`flex items-center gap-3 rounded-control border px-3 py-2 ${it.collected ? "border-line bg-chip text-muted" : "border-line"}`}>
                  {it.collected ? <span className="text-xs font-bold uppercase tracking-[0.08em]">Gone</span> : <input type="checkbox" name="item" value={it.id} checked={!!ticked[it.id]} onChange={(e) => setTicked((t) => ({ ...t, [it.id]: e.target.checked }))} className="h-6 w-6 accent-ink" aria-label={it.label} />}
                  <span className="font-semibold">{it.label}</span>
                </li>
              ))}
            </ul>
          </Field>
          <Field label="Name of the person collecting">
            <Input name="collector_name" defaultValue={v.collector_name} required textCase="title" />
          </Field>
          <label className="flex items-center gap-3 text-sm font-semibold">
            <input type="checkbox" name="handover_confirmed" className="h-6 w-6 accent-ink" defaultChecked={v.handover_confirmed === "on"} />
            Handover confirmed with the collecting person
          </label>
          {blocked ? (
            canApproveRelease ? (
              <div className="flex flex-col gap-2 rounded-card border border-amber-bar bg-amber-soft/40 p-3">
                <span className="text-sm font-semibold">{blockedText} Releasing anyway is written down.</span>
                <Field label="Reason for releasing">
                  <Input name="release_reason" defaultValue={v.release_reason} required textCase="sentence" />
                </Field>
              </div>
            ) : (
              <Notice tone="error">{blockedText} Only the owner or accounts can approve the release.</Notice>
            )
          ) : null}
          <SubmitButton size="lg" disabled={count === 0}>{count === left.length ? (left.length === items.length ? "All items collected, close the job" : "Last items collected, close the job") : `${count} item${count === 1 ? "" : "s"} collected, keep the rest`}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
