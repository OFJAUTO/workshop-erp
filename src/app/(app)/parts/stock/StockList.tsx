"use client";

import { useActionState, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Badge, Button, Input, LinkButton, Select } from "@/components/ui";
import { STOCK_STATUS_LABEL, STOCK_UNITS, type StockStatus } from "@/lib/stock-rules";
import type { StockAnswer } from "./manage-actions";

export type StockRow = {
  id: string;
  name: string;
  partNumber: string | null;
  placeholder: boolean;
  categoryId: string | null;
  categoryName: string | null;
  brand: string | null;
  quantity: number;
  unit: string;
  minimum: number;
  reorderQty: number;
  status: StockStatus;
  itemType: "part" | "consumable";
  supplierId: string | null;
  photoUrl: string | null;
  /** Only for those who see costs (never sent to a viewer). */
  cost?: number;
};

type Opt = { id: string; name: string };
type Job = { id: string; label: string };
type TechGroup = { label: string; members: Opt[] };

const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toneOf = (s: StockStatus) => (s === "out" ? "red" : s === "low" ? "amber" : "green");

function Answer({ s }: { s: StockAnswer }) {
  if (!s) return null;
  return s.error ? <p className="text-sm font-semibold text-red" data-stock-answer-error>{s.error}</p> : <p className="text-sm font-semibold text-green-text" data-stock-answer>{s.words}</p>;
}

/**
 * THE stock list (20 November 2026, Section 5): one row per item (photo, name, part number, category, brand, quantity
 * with unit, cost for those who see it, status), and a side panel per row: Issue to a job, Adjust, Reorder, Edit,
 * Archive, Merge. A viewer (the personal "Can view stock" switch) sees the details only: no cost, no actions.
 */
export function StockList(p: {
  rows: StockRow[];
  manage: boolean;
  seesCost: boolean;
  categories: Opt[];
  suppliers: Opt[];
  jobs: Job[];
  techs: TechGroup[];
  others: Opt[];
  pinAbove: number;
  openId: string | null;
  sortHrefs: Record<string, string>;
  issue: (f: FormData) => void | Promise<void>;
  adjust: (f: FormData) => void | Promise<void>;
  saveItem: (f: FormData) => void | Promise<void>;
  archive: (id: string, s: StockAnswer, f: FormData) => Promise<StockAnswer>;
  merge: (id: string, s: StockAnswer, f: FormData) => Promise<StockAnswer>;
  photo: (id: string, s: StockAnswer, f: FormData) => Promise<StockAnswer>;
  /** An empty item archived in one tap (its history stays). */
  quickArchive?: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState<string | null>(p.openId);
  const row = p.rows.find((r) => r.id === open) ?? null;
  return (
    <>
      <div className="overflow-x-auto" data-scroll-ok>
        <table className="w-full min-w-[44rem] text-sm" data-stock-table>
          <thead>
            <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-muted">
              <th className="py-2 pr-2 w-12"></th>
              <th className="py-2 pr-2"><Link href={p.sortHrefs["name"]} className="underline-offset-4 hover:underline" data-sort="name">Item</Link></th>
              <th className="py-2 pr-2"><Link href={p.sortHrefs["category"]} className="underline-offset-4 hover:underline" data-sort="category">Category</Link></th>
              <th className="py-2 pr-2">Brand</th>
              <th className="py-2 pr-2 text-right"><Link href={p.sortHrefs["qty"]} className="underline-offset-4 hover:underline" data-sort="qty">Quantity</Link></th>
              {p.seesCost ? <th className="py-2 pr-2 text-right"><Link href={p.sortHrefs["cost"]} className="underline-offset-4 hover:underline" data-sort="cost">Cost</Link></th> : null}
              <th className="py-2 pr-2"><Link href={p.sortHrefs["status"]} className="underline-offset-4 hover:underline" data-sort="status">Status</Link></th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {p.rows.map((r) => (
              <tr key={r.id} data-stock-row={r.id} data-status={r.status}>
                <td className="py-2 pr-2">{/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.photoUrl ? <img src={r.photoUrl} alt="" className="h-10 w-10 rounded-control object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-control bg-chip text-xs text-muted">—</span>}</td>
                <td className="py-2 pr-2">
                  <span className="block font-semibold uppercase">{r.name}</span>
                  {r.partNumber ? <span className="text-xs text-muted">{r.partNumber}</span> : null}
                  {r.placeholder ? <Badge tone="amber" data-placeholder-pn>Placeholder part number</Badge> : null}
                </td>
                <td className="py-2 pr-2">{r.categoryName ? <Badge tone="outline">{r.categoryName}</Badge> : <span className="text-xs text-muted">—</span>}</td>
                <td className="py-2 pr-2 text-xs">{r.brand ?? "—"}</td>
                <td className="py-2 pr-2 text-right font-bold whitespace-nowrap" data-stock-qty>{r.quantity} {r.unit}{r.minimum > 0 ? <span className="block text-xs font-normal text-muted">min {r.minimum}</span> : <span className="block text-xs font-normal text-amber-text" data-no-minimum>no minimum</span>}</td>
                {p.seesCost ? <td className="py-2 pr-2 text-right whitespace-nowrap" data-stock-cost>{money(r.cost ?? 0)}</td> : null}
                <td className="py-2 pr-2 whitespace-nowrap"><Badge tone={toneOf(r.status)} data-stock-status={r.status}>{STOCK_STATUS_LABEL[r.status]}</Badge></td>
                <td className="py-2 text-right">
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    <Button type="button" tone="secondary" size="md" onClick={() => setOpen(r.id)} data-stock-open={r.id}>{p.manage ? "Open" : "View"}</Button>
                    {p.manage && p.quickArchive && Math.abs(r.quantity) < 0.0005 ? <form action={p.quickArchive.bind(null, r.id)}><Button type="submit" tone="ghost" size="md" data-archive-item={r.id}>Archive</Button></form> : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {row ? <SidePanel row={row} p={p} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

type Tab = "issue" | "adjust" | "reorder" | "edit" | "archive" | "merge";

function SidePanel({ row, p, onClose }: { row: StockRow; p: Parameters<typeof StockList>[0]; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(p.manage ? "issue" : "edit");
  const [archived, archiveAction, archiving] = useActionState(p.archive.bind(null, row.id), null);
  const [merged, mergeAction, merging] = useActionState(p.merge.bind(null, row.id), null);
  const [photoSaved, photoAction, photoing] = useActionState(p.photo.bind(null, row.id), null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  const tabs: { key: Tab; label: string }[] = p.manage ? [{ key: "issue", label: "Issue to a job" }, { key: "adjust", label: "Adjust" }, { key: "reorder", label: "Reorder" }, { key: "edit", label: "Edit" }, { key: "archive", label: "Archive" }, { key: "merge", label: "Merge" }] : [];
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" aria-label={row.name} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-stock-panel={row.id}>
      <div className="flex h-full w-full max-w-lg flex-col gap-3 overflow-y-auto bg-white p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-lg font-extrabold uppercase">{row.name}</span>
            <span className="text-xs text-muted">{[row.partNumber, row.categoryName, row.brand].filter(Boolean).join(" · ") || "—"}</span>
            <span className="text-sm font-bold">{row.quantity} {row.unit} · <span data-panel-status>{STOCK_STATUS_LABEL[row.status]}</span>{p.seesCost ? ` · ${money(row.cost ?? 0)} each` : ""}</span>
          </div>
          <Button type="button" tone="ghost" size="md" onClick={onClose} data-stock-panel-close>Close</Button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {row.photoUrl ? <img src={row.photoUrl} alt="" className="max-h-48 w-full rounded-control object-contain bg-chip" /> : null}
        {!p.manage ? <p className="text-sm text-muted" data-stock-view-only>View only: items, quantities and status. Ask the parts desk to issue, adjust or order.</p> : null}
        {tabs.length ? (
          <div className="flex flex-wrap gap-1.5" data-stock-tabs>
            {tabs.map((t) => <Button key={t.key} type="button" tone={tab === t.key ? "primary" : "secondary"} size="md" onClick={() => setTab(t.key)} data-stock-tab={t.key}>{t.label}</Button>)}
          </div>
        ) : null}
        {p.manage && tab === "issue" ? (
          <form action={p.issue} className="flex flex-col gap-3" data-stock-issue>
            <input type="hidden" name="stock_item" value={row.id} />
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Job</span><Select name="job" required><option value="">Choose…</option>{p.jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</Select></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity ({row.unit})</span><Input name="quantity" inputMode="decimal" required spell={false} /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Technician</span><Select name="technician" required><option value="">Choose…</option>{p.techs.map((g) => <optgroup key={g.label} label={g.label}>{g.members.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}</Select></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Technician&apos;s PIN (needed above AED {p.pinAbove})</span><Input name="pin" type="password" inputMode="numeric" maxLength={4} autoComplete="off" spell={false} /></label>
            <div><Button type="submit" size="md" data-stock-issue-save>Issue</Button></div>
          </form>
        ) : null}
        {p.manage && tab === "adjust" ? (
          <form action={p.adjust} className="flex flex-col gap-3" data-stock-adjust>
            <input type="hidden" name="id" value={row.id} />
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Change (minus takes off)</span><Input name="delta" inputMode="decimal" placeholder="-2" spell={false} required /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Why</span><Input name="note" placeholder="Spilled, miscounted, …" required /></label>
            <div><Button type="submit" size="md">Adjust</Button></div>
          </form>
        ) : null}
        {p.manage && tab === "reorder" ? (
          <div className="flex flex-col gap-2" data-stock-reorder>
            <p className="text-sm">Starts a stock LPO draft for {row.name}{row.reorderQty ? ` (reorder ${row.reorderQty} ${row.unit})` : ""}: pick the supplier and send it for approval.</p>
            <div><LinkButton href={`/parts/stock?reorder=${row.id}`} size="md" data-stock-reorder-start>Start the stock LPO</LinkButton></div>
          </div>
        ) : null}
        {p.manage && tab === "edit" ? (
          <div className="flex flex-col gap-3">
            <form action={p.saveItem} className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-stock-edit>
              <input type="hidden" name="id" value={row.id} />
              <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-xs font-semibold text-muted">Item</span><Input name="name" defaultValue={row.name} required /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Part number</span><Input name="part_number" defaultValue={row.partNumber ?? ""} textCase="upper" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Brand</span><Input name="brand" defaultValue={row.brand ?? ""} spell={false} /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Category</span><Select name="category_id" defaultValue={row.categoryId ?? ""}><option value="">–</option>{p.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Unit</span><Select name="unit" defaultValue={(STOCK_UNITS as readonly string[]).includes(row.unit) ? row.unit : ""} required data-stock-unit><option value="">Pick…</option>{STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</Select></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Kind</span><Select name="item_type" defaultValue={row.itemType}><option value="part">Stock part</option><option value="consumable">Consumable</option></Select></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Minimum</span><Input name="minimum_level" defaultValue={String(row.minimum)} inputMode="decimal" spell={false} /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Reorder qty</span><Input name="reorder_quantity" defaultValue={String(row.reorderQty)} inputMode="decimal" spell={false} /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Supplier</span><Select name="supplier_id" defaultValue={row.supplierId ?? ""}><option value="">–</option>{p.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
              <div className="sm:col-span-2"><Button type="submit" size="md" data-stock-edit-save>Save</Button></div>
            </form>
            <form action={photoAction} className="flex flex-wrap items-center gap-2" data-stock-photo>
              <input type="file" name="photo" accept="image/*" capture="environment" className="text-sm" />
              <Button type="submit" tone="secondary" size="md" disabled={photoing}>Save photo</Button>
              <Answer s={photoSaved} />
            </form>
          </div>
        ) : null}
        {p.manage && tab === "archive" ? (
          <form action={archiveAction} className="flex flex-col gap-2" data-stock-archive>
            <p className="text-sm">Archive takes it off the list; its history stays. An item with stock on the shelf is adjusted (or counted) to 0 first.</p>
            <Input name="reason" placeholder="Why (e.g. no longer stocked)" required minLength={3} />
            <div><Button type="submit" tone="secondary" size="md" disabled={archiving} data-stock-archive-save>Archive</Button></div>
            <Answer s={archived} />
          </form>
        ) : null}
        {p.manage && tab === "merge" ? (
          <form action={mergeAction} className="flex flex-col gap-2" data-stock-merge>
            <p className="text-sm">The same item twice? Merge the other one INTO {row.name}: its quantity moves here, its history stays, it is archived.</p>
            <Select name="gone" required data-stock-merge-other><option value="">The duplicate…</option>{p.others.filter((o) => o.id !== row.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>
            <Input name="reason" placeholder="Why they are the same" required minLength={3} />
            <div><Button type="submit" size="md" disabled={merging} data-stock-merge-save>Merge into {row.name}</Button></div>
            <Answer s={merged} />
          </form>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
