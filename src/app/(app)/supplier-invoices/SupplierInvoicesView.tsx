import Link from "next/link";
import { SlipTile } from "@/components/PaymentReport";
import { ViewerThumb } from "@/components/PhotoViewer";
import { SupplierProofUpload } from "@/app/(app)/parts/orders/[id]/SupplierProofUpload";
import { Badge, Button, Card, Input, LinkButton, Notice, SectionLabel, Select } from "@/components/ui";
import type { CurrentStaff } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { MATCH_WORDS, STATUS_WORDS, approvedVsInvoiced, filterInvoices, invWords, invoiceFilterOf, invoiceFilterParams, unpaidBySupplier, unpaidShares, type InvoiceRow, type InvoiceStatus } from "@/lib/supplier-invoice-rows";
import { invoiceEditReady, invoiceVatReady, loadInvoiceEdits, loadSupplierInvoices, siQueryReady } from "@/lib/supplier-invoices";
import { InvoiceEditHistory, SupplierInvoiceEditButton } from "@/components/SupplierInvoiceEdit";
import { editSupplierInvoice } from "@/app/(app)/parts/order-actions";
import { signJobFiles } from "@/lib/work-data";
import { changeWords } from "@/lib/price-change";
import { enterInvoiceFromList } from "@/app/(app)/parts/order-actions";
import { checkInvoiceAction, queryInvoiceAction } from "./actions";
import { ScanEnterInvoice } from "./ScanEnterInvoice";

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_TONE: Record<InvoiceStatus, "amber" | "red" | "neutral" | "green" | "ink" | "outline"> = { waiting: "amber", queried: "red", new: "ink", checked: "outline", zoho: "outline", paid: "green" };

export type SiSearch = { open?: string; supplier?: string; from?: string; to?: string; status?: string; unpaid?: string; problems?: string; no_proof?: string; q?: string; job?: string; message?: string; error?: string };

/** Where the view lives: its own page (/supplier-invoices, Parts keep it) or the Supplier invoices tab of Parts accounts. */
export type SiPlace = "supplier-invoices" | "parts-accounts";

/** The address of the view with these filters (and the tab when it sits inside Parts accounts). */
export function siHref(place: SiPlace, params: [string, string][] = []): string {
  const p = new URLSearchParams(place === "parts-accounts" ? [["tab", "invoices"], ...params] : params);
  const s = p.toString();
  return `/${place}${s ? `?${s}` : ""}`;
}

/**
 * SUPPLIER INVOICES (1 November 2026; one shared view since 3 November): one clean row per supplier invoice with its
 * LPOs and cars, the match against the LPO, and its status New → Checked by accounts → Sent to Zoho (bill) → Paid to
 * supplier. Accounts and the owner check or query; the parts desk sees it (they enter invoices on the LPO and the
 * receiving panel). Opening a row shows the invoice next to the parts it covers, per car. The same view is the
 * /supplier-invoices page and the Supplier invoices tab of Parts accounts.
 */
export async function SupplierInvoicesView({ sp, staff, place }: { sp: SiSearch; staff: CurrentStaff; place: SiPlace }) {
  const acts = ["owner", "accounts"].includes(staff.role_id) && !staff.viewingAs;
  // Strict: a list that could not be read says so, never "no supplier invoices".
  const read = await loadSupplierInvoices({ strict: true }).catch(() => null);
  const all = read?.rows ?? [];
  const partNames = read?.partNames ?? new Map<string, string[]>();
  const rows = filterInvoices(all, invoiceFilterOf((k) => sp[k]), partNames);
  const open = sp.open ? all.find((r) => r.key === sp.open) ?? null : null;
  const suppliers = Array.from(new Map(all.map((r) => [r.supplierId ?? r.supplier, r.supplier])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const unpaid = unpaidBySupplier(rows);
  const kept = invoiceFilterParams(sp);
  const hrefOpen = (key: string) => siHref(place, [...kept, ["open", key]]);
  const queryOn = await siQueryReady();
  // The answer of Mark checked / Query sits next to those buttons, inside the opened invoice; at the top only when no
  // invoice is open (the row is gone, or nothing was opened).
  const outcome = sp.message || sp.error ? { tone: sp.error ? ("error" as const) : ("success" as const), text: sp.error || sp.message || "" } : null;

  return (
    <>
      {!read ? <Notice tone="error">Couldn&apos;t read the supplier invoices just now: reload the page.</Notice> : null}
      {outcome && !open ? <Notice tone={outcome.tone}>{outcome.text}</Notice> : null}
      {open ? <OpenInvoice row={open} acts={acts} queryOn={queryOn} place={place} outcome={outcome} /> : null}

      <Card className="flex flex-col gap-3" data-si-filters>
        <form method="get" action={`/${place}`} className="flex flex-wrap items-end gap-2">
          {place === "parts-accounts" ? <input type="hidden" name="tab" value="invoices" /> : null}
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Search<Input name="q" defaultValue={sp.q ?? ""} placeholder="Invoice no., plate, part name, LPO" className="w-72" data-si-search /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Supplier
            <Select name="supplier" defaultValue={sp.supplier ?? ""} className="w-56">
              <option value="">All suppliers</option>
              {suppliers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Status
            <Select name="status" defaultValue={sp.status ?? ""} className="w-52" data-si-status-filter>
              <option value="">Any status</option>
              {(Object.keys(STATUS_WORDS) as InvoiceStatus[]).map((s) => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">From<Input type="date" name="from" defaultValue={sp.from ?? ""} className="w-40" /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">To<Input type="date" name="to" defaultValue={sp.to ?? ""} className="w-40" /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="unpaid" value="1" defaultChecked={sp.unpaid === "1"} className="h-5 w-5 accent-ink" />Unpaid</label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="problems" value="1" defaultChecked={sp.problems === "1"} className="h-5 w-5 accent-ink" />Match problems</label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold" data-si-no-proof-filter><input type="checkbox" name="no_proof" value="1" defaultChecked={sp.no_proof === "1"} className="h-5 w-5 accent-ink" />Paid without proof</label>
          <Button type="submit" size="md" tone="secondary">Show</Button>
          {kept.length ? <Link href={siHref(place)} className="min-h-11 inline-flex items-center text-sm font-bold underline underline-offset-4">Clear</Link> : null}
        </form>
        <div className="flex flex-wrap items-center gap-2 text-sm" data-si-totals>
          <span className="font-extrabold">{rows.length} invoice{rows.length === 1 ? "" : "s"} · AED {money(rows.filter((r) => r.status !== "waiting").reduce((a, r) => a + r.total, 0))} with VAT</span>
          {unpaid.length ? <span className="text-muted">Unpaid:</span> : null}
          {unpaid.slice(0, 8).map((u) => <span key={u.supplierId ?? u.supplier} className="rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-semibold" data-si-unpaid>{u.supplier} · {u.count} · AED {money(u.total)}</span>)}
          {all.filter((r) => r.proofMissing).length ? <Link href={siHref(place, [...invoiceFilterParams({ no_proof: "1" })])} className="rounded-full border border-red-bar px-2.5 py-0.5 text-xs font-bold text-red" data-si-no-proof-count>Paid without proof · {all.filter((r) => r.proofMissing).length}</Link> : null}
        </div>
      </Card>

      <section className="flex flex-col gap-2" data-si-list>
        {rows.length === 0 ? <Card><p className="text-sm text-muted">No supplier invoices match.</p></Card> : null}
        {rows.map((r) => <InvoiceCard key={r.key} r={r} href={hrefOpen(r.key)} open={open?.key === r.key} />)}
      </section>
    </>
  );
}

function MatchChips({ r }: { r: InvoiceRow }) {
  return (
    <>
      {r.match.map((m) => <span key={m} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${m === "matches" ? "bg-green-soft text-green" : "border border-amber-bar bg-amber-soft text-amber"}`} data-si-match={m}>{MATCH_WORDS[m]}</span>)}
      {r.duplicateOf ? <span className="rounded-full border border-red-bar bg-white px-2 py-0.5 text-[11px] font-bold text-red" data-si-duplicate>Possible duplicate of {r.duplicateOf}</span> : null}
    </>
  );
}

function InvoiceCard({ r, href, open }: { r: InvoiceRow; href: string; open: boolean }) {
  return (
    <Card className={`relative !p-0 hover:border-ink ${open ? "!border-ink" : ""} ${r.duplicateOf ? "!border-red-bar" : ""}`} data-si-row={r.key} data-si-state={r.status}>
      <Link href={href} aria-label={`Open ${r.number ? `invoice ${r.number}` : "the invoice"} of ${r.supplier}`} className="absolute inset-0 z-0 rounded-card" data-overlap-ok data-si-open />
      <div className="pointer-events-none relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 p-4">
        <span className="font-extrabold uppercase">{r.supplier}</span>
        <span className="font-semibold">{invWords(r.number)}</span>
        {r.date ? <span className="text-sm text-muted">{formatDate(r.date)}</span> : null}
        <Badge tone={STATUS_TONE[r.status]}>{STATUS_WORDS[r.status]}</Badge>
        {r.partlyPaid ? <span className="rounded-full border border-amber-bar bg-amber-soft px-2 py-0.5 text-[11px] font-bold text-amber" data-si-partly-paid>Partly paid · AED {money(r.unpaidAmount)} to pay</span> : null}
        {r.proofMissing ? <span className="rounded-full border border-red-bar bg-white px-2 py-0.5 text-[11px] font-bold text-red" data-si-proof-missing-tag>Proof missing – upload</span> : null}
        <MatchChips r={r} />
        <span className="ml-auto text-sm font-extrabold" data-si-total>AED {money(r.total)}</span>
        <span className="basis-full text-xs text-muted">
          {r.trn ? `TRN ${r.trn} · ` : r.vatRegistered ? "No TRN on file · " : "Not VAT registered · "}
          before VAT {money(r.beforeVat)} · VAT {money(r.vat)} ·{" "}
          {r.shares.map((s, i) => <span key={s.poId} className="whitespace-nowrap">{s.poNumber}{i < r.shares.length - 1 ? ", " : ""}</span>)} ·{" "}
          {r.shares.some((s) => s.jobNumber || s.plate) ? r.shares.filter((s) => s.jobNumber || s.plate).map((s, i, all) => <span key={`car-${s.poId}`} className="whitespace-nowrap">{[s.jobNumber, s.plate].filter(Boolean).join(" ")}{i < all.length - 1 ? ", " : ""}</span>) : "stock order"} · {r.parts} part{r.parts === 1 ? "" : "s"}
        </span>
      </div>
    </Card>
  );
}

/** One invoice opened: the scan or photo (zoomable) next to the parts it covers, per car, with Checked and Query. */
async function OpenInvoice({ row, acts, queryOn, place, outcome }: { row: InvoiceRow; acts: boolean; queryOn: boolean; place: SiPlace; outcome: { tone: "success" | "error"; text: string } | null }) {
  const admin = createAdminClient();
  const poIds = row.shares.map((s) => s.poId);
  const vatOn = await invoiceVatReady();
  const [{ data: files }, { data: pos }, { data: lines }] = await Promise.all([
    admin.from("job_files").select("id, storage_path, content_type, caption").eq("kind", "supplier_invoice").in("ref_id", poIds).is("removed_at", null).order("created_at"),
    admin.from("purchase_orders").select("id, supplier_invoice_path, supplier_invoice_amount, supplier_paid_at, supplier_paid_method, supplier_paid_reference, supplier_paid_proof_path, supplier_paid_by" + (vatOn ? ", supplier_invoice_vat_aed" : "")).in("id", poIds),
    admin.from("purchase_order_lines").select("id, po_id, description, quantity, received_qty, unit_cost, invoice_unit_cost, invoice_check").in("po_id", poIds).eq("is_active", true).order("position"),
  ]);
  type PaidPo = { id: string; supplier_invoice_path: string | null; supplier_invoice_amount: number | null; supplier_paid_at: string | null; supplier_paid_method: string | null; supplier_paid_reference: string | null; supplier_paid_proof_path: string | null; supplier_paid_by: string | null; supplier_invoice_vat_aed?: number | null };
  // The select string is built (the vat column is ready-gated), so the result loses its type: cast it.
  const poRows = (pos ?? []) as unknown as PaidPo[];
  // Fix 4 (4 November 2026): the proof of payment shows next to "Open the invoice (PDF)", signed like the scans.
  const paths = Array.from(new Set([...((files ?? []) as { storage_path: string }[]).map((f) => f.storage_path), ...poRows.map((p) => p.supplier_invoice_path).filter((x): x is string => !!x), ...poRows.map((p) => p.supplier_paid_proof_path).filter((x): x is string => !!x)]));
  const urls = await signJobFiles(paths);
  const kinds = new Map(((files ?? []) as { storage_path: string; content_type: string | null }[]).map((f) => [f.storage_path, f.content_type ?? ""]));
  const isPdf = (p: string) => /pdf/i.test(kinds.get(p) ?? "") || /\.pdf$/i.test(p);
  // Paid LPO by LPO: each LPO of the invoice with its own payment (a split invoice can be partly paid).
  const payOf = new Map(poRows.map((p) => [p.id, p]));
  const payerIds = Array.from(new Set(poRows.map((p) => p.supplier_paid_by).filter((x): x is string => !!x)));
  const { data: payers } = payerIds.length ? await admin.from("staff").select("id, display_name").in("id", payerIds) : { data: [] };
  const payerOf = new Map(((payers ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  const toPay = unpaidShares(row);
  // Supplier invoice edit (5 November 2026): the Edit button (owner + accounts), "Approved → Invoiced" and the record of edits.
  const editOn = acts && row.status !== "waiting" ? await invoiceEditReady() : false;
  const edits = await loadInvoiceEdits(poIds);
  const vsApproved = row.status === "waiting" ? null : approvedVsInvoiced(Math.round(row.shares.reduce((a, s) => a + s.lpoTotal, 0) * 100) / 100, row.beforeVat);
  return (
    <Card className="flex flex-col gap-4 !border-ink" id="open" data-si-opened={row.key}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel>{invWords(row.number)} · {row.supplier}</SectionLabel>
        <Badge tone={STATUS_TONE[row.status]}>{STATUS_WORDS[row.status]}</Badge>
        <MatchChips r={row} />
      </div>
      {row.query ? <Notice tone="error">Queried with Parts: {row.query}</Notice> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="flex flex-col gap-2 lg:col-span-2" data-si-files>
          {paths.length ? paths.map((p) => (urls[p] ? (isPdf(p) ? (
            <a key={p} href={urls[p]} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-3 text-sm font-bold" data-si-pdf>Open the invoice (PDF)</a>
          ) : (
            <ViewerThumb key={p} src={urls[p]} label={`Invoice ${row.number ?? ""} · ${row.supplier}`} className="block overflow-hidden rounded-control border border-line" data-si-image>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={urls[p]} alt={`Supplier invoice ${row.number ?? ""}`} className="max-h-[28rem] w-full object-contain bg-canvas" />
            </ViewerThumb>
          )) : null)) : <p className="text-sm text-muted">No scan or photo yet. Parts add it on the LPO page.</p>}
        </div>
        <div className="flex flex-col gap-3 lg:col-span-3" data-si-parts>
          {row.shares.map((s) => (
            <div key={s.poId} className="flex flex-col gap-1" data-si-car={s.jobId ?? "stock"}>
              <span className="text-sm font-extrabold">
                {s.jobId ? <Link href={`/jobs/${s.jobId}`} className="underline underline-offset-4">{[s.jobNumber, s.plate, s.car].filter(Boolean).join(" · ")}</Link> : "Stock order"} · <Link href={`/parts/orders/${s.poId}`} className="underline underline-offset-4">{s.poNumber}</Link> · share AED {money(s.amount)}
              </span>
              <ul className="divide-y divide-line text-sm">
                {((lines ?? []) as { po_id: string; description: string; quantity: number; received_qty: number; unit_cost: number; invoice_unit_cost: number | null }[]).filter((l) => l.po_id === s.poId).map((l, i) => {
                  const inv = l.invoice_unit_cost === null ? null : Number(l.invoice_unit_cost);
                  const diff = inv !== null && Math.abs(inv - Number(l.unit_cost)) > 0.005;
                  const short = Number(l.received_qty) + 0.001 < Number(l.quantity);
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-2 py-1.5" data-si-line>
                      <span className="min-w-0 flex-1 font-semibold uppercase">{l.description}</span>
                      <span className={short ? "font-bold text-amber" : "text-muted"}>× {Number(l.quantity)}{short ? ` (received ${Number(l.received_qty)})` : ""}</span>
                      <span className={diff ? "font-bold text-amber" : "text-muted"} data-si-prices>{changeWords({ quantity: Number(l.quantity), received_qty: Number(l.received_qty), unit_cost: Number(l.unit_cost), invoice_unit_cost: inv }) ?? `Approved ${money(Number(l.unit_cost))}${inv !== null ? ` · invoiced ${money(inv)}` : ""}`}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="text-sm">Before VAT <b>AED {money(row.beforeVat)}</b> · VAT AED {money(row.vat)} · Total <b>AED {money(row.total)}</b>{row.trn ? ` · TRN ${row.trn}` : ""}</p>
          {vsApproved ? <p className="text-sm font-bold" data-si-vs-approved>{vsApproved}</p> : null}
          {row.status !== "waiting" && (row.paidAmount > 0 || row.shares.length > 1) ? (
            <ul className="flex flex-col gap-1.5 text-sm" data-si-paid-lines>
              {row.shares.map((s) => {
                const p = payOf.get(s.poId);
                if (!p?.supplier_paid_at) return <li key={s.poId} className="font-semibold" data-si-share-unpaid={s.poId}>{s.poNumber}: not paid yet · AED {money(s.amount)} before VAT</li>;
                const by = p.supplier_paid_by ? payerOf.get(p.supplier_paid_by) : null;
                return (
                  <li key={s.poId} className="flex flex-col gap-1" data-si-share-paid={s.poId}>
                    <span className="font-semibold text-green">{s.poNumber}: paid to supplier {formatDateTime(p.supplier_paid_at)}{p.supplier_paid_method ? ` · ${p.supplier_paid_method}` : ""}{p.supplier_paid_reference ? ` · ref ${p.supplier_paid_reference}` : ""}{by ? ` · by ${by}` : ""}</span>
                    {/* Fix 4 (4 November 2026): the PROOF OF PAYMENT, right where the invoice is checked. */}
                    {p.supplier_paid_proof_path ? (
                      <span className="inline-flex items-center gap-2 self-start rounded-control border border-line bg-chip px-2 py-1.5" data-si-proof={s.poId}>
                        <SlipTile url={urls[p.supplier_paid_proof_path] ?? null} path={p.supplier_paid_proof_path} label={`Proof of payment · ${s.poNumber}`} hook={`si-proof-${s.poId}`} />
                        <span className="text-xs font-bold uppercase tracking-[0.06em]">Proof of payment</span>
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2" data-si-proof-missing={s.poId}>
                        <span className="rounded-full border border-red-bar px-2 py-0.5 text-[11px] font-bold text-red">Proof missing – upload</span>
                        {acts ? <SupplierProofUpload poId={s.poId} /> : null}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
      <InvoiceEditHistory entries={edits} />
      {outcome ? <div data-si-outcome={outcome.tone}><Notice tone={outcome.tone}>{outcome.text}</Notice></div> : null}
      {/* 4 November 2026: a row still waiting for its invoice - accounts scan the paper and enter it right here. */}
      {acts && row.status === "waiting" && row.shares.length === 1 ? (
        <ScanEnterInvoice
          poId={row.shares[0].poId}
          rowKey={row.key}
          jobId={row.shares[0].jobId}
          poTotal={row.shares[0].lpoTotal}
          lines={((lines ?? []) as { id: string; po_id: string; description: string; unit_cost: number }[]).filter((l) => l.po_id === row.shares[0].poId).map((l) => ({ id: l.id, description: l.description, unit_cost: Number(l.unit_cost) }))}
          action={enterInvoiceFromList.bind(null, row.shares[0].poId, row.key)}
        />
      ) : null}
      {acts && row.status !== "waiting" ? (
        <div className="flex flex-wrap items-start gap-3 border-t border-line pt-3">
          {row.status === "new" || row.status === "queried" ? (
            <form action={checkInvoiceAction.bind(null, row.key)}>
              <input type="hidden" name="from" value={place} />
              <Button type="submit" size="lg" data-si-check>Mark checked</Button>
            </form>
          ) : null}
          {row.status !== "paid" ? (
            <form action={queryInvoiceAction.bind(null, row.key)} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="from" value={place} />
              <Input name="comment" required minLength={3} placeholder="What should Parts check?" className="w-72" textCase="sentence" disabled={!queryOn} aria-label="Query for the parts desk" data-si-query-text />
              <Button type="submit" size="lg" tone="secondary" disabled={!queryOn} data-si-query>Query with Parts</Button>
            </form>
          ) : null}
          {!queryOn ? <span className="text-xs text-muted">Query switches on with the database update (waiting for apply).</span> : null}
          {/* Supplier invoice edit (5 November 2026): owner + accounts, compulsory remark; one button per LPO of a split invoice. */}
          {editOn
            ? row.shares.map((s) => {
                const p = payOf.get(s.poId);
                const amt = p?.supplier_invoice_amount ?? null;
                const vatEff = p?.supplier_invoice_vat_aed ?? (amt ? Math.round(amt * 5) / 100 : null);
                return (
                  <SupplierInvoiceEditButton
                    key={`edit-${s.poId}`}
                    action={editSupplierInvoice.bind(null, s.poId)}
                    back={siHref(place, [["open", row.key]])}
                    poNumber={s.poNumber}
                    number={row.number ?? ""}
                    date={String(row.date ?? "").slice(0, 10)}
                    amount={amt}
                    vat={vatEff}
                    lpoTotal={s.lpoTotal}
                    lines={((lines ?? []) as { id: string; po_id: string; description: string; quantity: number; unit_cost: number; invoice_unit_cost: number | null }[]).filter((l) => l.po_id === s.poId).map((l) => ({ id: l.id, description: l.description, quantity: Number(l.quantity) || 0, price: Number(l.invoice_unit_cost ?? l.unit_cost) || 0 }))}
                    paid={!!p?.supplier_paid_at}
                    label={row.shares.length > 1 ? `Edit invoice · ${s.poNumber}` : "Edit invoice"}
                  />
                );
              })
            : null}
          {/* Paid on each LPO's own page: one button per LPO still to pay, never one already paid. */}
          {toPay.map((s) => <LinkButton key={s.poId} href={`/parts/orders/${s.poId}#paid`} tone="ghost" size="lg" data-si-pay={s.poId}>{toPay.length > 1 || row.shares.length > 1 ? `Pay ${s.poNumber} (on the LPO)` : "Paid to supplier (on the LPO)"}</LinkButton>)}
        </div>
      ) : null}
    </Card>
  );
}
