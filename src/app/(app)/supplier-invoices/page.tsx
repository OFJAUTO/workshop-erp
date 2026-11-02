import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ViewerThumb } from "@/components/PhotoViewer";
import { Badge, Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { MATCH_WORDS, STATUS_WORDS, filterInvoices, invWords, unpaidBySupplier, type InvoiceRow, type InvoiceStatus } from "@/lib/supplier-invoice-rows";
import { loadSupplierInvoices, siQueryReady } from "@/lib/supplier-invoices";
import { signJobFiles } from "@/lib/work-data";
import { changeWords } from "@/lib/price-change";
import { checkInvoiceAction, queryInvoiceAction } from "./actions";

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_TONE: Record<InvoiceStatus, "amber" | "red" | "neutral" | "green" | "ink" | "outline"> = { waiting: "amber", queried: "red", new: "ink", checked: "outline", zoho: "outline", paid: "green" };

type Search = { open?: string; supplier?: string; from?: string; to?: string; status?: string; unpaid?: string; problems?: string; q?: string; job?: string; message?: string; error?: string };

/**
 * SUPPLIER INVOICES (1 November 2026): one clean row per supplier invoice with its LPOs and cars, the match against the
 * LPO, and its status New → Checked by accounts → Sent to Zoho (bill) → Paid to supplier. Accounts and the owner check
 * or query; the parts desk sees it (they enter invoices on the LPO and the receiving panel). Opening a row shows the
 * invoice next to the parts it covers, per car.
 */
export default async function SupplierInvoicesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireStaff();
  if (!["owner", "accounts", "parts"].includes(staff.role_id)) notFound();
  const sp = await searchParams;
  const acts = ["owner", "accounts"].includes(staff.role_id) && !staff.viewingAs;
  const { rows: all, partNames } = await loadSupplierInvoices();
  const rows = filterInvoices(all, { supplier: sp.supplier, from: sp.from, to: sp.to, status: sp.status, unpaid: sp.unpaid === "1", problems: sp.problems === "1", q: sp.q, job: sp.job }, partNames);
  const open = sp.open ? all.find((r) => r.key === sp.open) ?? null : null;
  const suppliers = Array.from(new Map(all.map((r) => [r.supplierId ?? r.supplier, r.supplier])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const unpaid = unpaidBySupplier(rows);
  const params = new URLSearchParams(Object.entries({ supplier: sp.supplier ?? "", from: sp.from ?? "", to: sp.to ?? "", status: sp.status ?? "", unpaid: sp.unpaid ?? "", problems: sp.problems ?? "", q: sp.q ?? "", job: sp.job ?? "" }).filter(([, v]) => v));
  const hrefOpen = (key: string) => `/supplier-invoices?${new URLSearchParams([...params.entries(), ["open", key]]).toString()}`;
  const queryOn = await siQueryReady();

  return (
    <>
      <LiveRefresh tables={["purchase_orders"]} />
      <PageHeader title="Supplier invoices" subtitle="Every supplier invoice with its LPOs and cars. Accounts check it (the bill then goes to Zoho Books) or query it back to Parts." actions={<LinkButton href={`/api/export/supplier-invoices?${params.toString()}`} tone="secondary" size="lg" data-si-export>Export to Excel</LinkButton>} />
      {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}

      {open ? <OpenInvoice row={open} acts={acts} queryOn={queryOn} /> : null}

      <Card className="flex flex-col gap-3" data-si-filters>
        <form method="get" action="/supplier-invoices" className="flex flex-wrap items-end gap-2">
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
          <Button type="submit" size="md" tone="secondary">Show</Button>
          {params.toString() ? <Link href="/supplier-invoices" className="min-h-11 inline-flex items-center text-sm font-bold underline underline-offset-4">Clear</Link> : null}
        </form>
        <div className="flex flex-wrap items-center gap-2 text-sm" data-si-totals>
          <span className="font-extrabold">{rows.length} invoice{rows.length === 1 ? "" : "s"} · AED {money(rows.filter((r) => r.status !== "waiting").reduce((a, r) => a + r.total, 0))} with VAT</span>
          {unpaid.length ? <span className="text-muted">Unpaid:</span> : null}
          {unpaid.slice(0, 8).map((u) => <span key={u.supplier} className="rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-semibold" data-si-unpaid>{u.supplier} · {u.count} · AED {money(u.total)}</span>)}
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
async function OpenInvoice({ row, acts, queryOn }: { row: InvoiceRow; acts: boolean; queryOn: boolean }) {
  const admin = createAdminClient();
  const poIds = row.shares.map((s) => s.poId);
  const [{ data: files }, { data: pos }, { data: lines }] = await Promise.all([
    admin.from("job_files").select("id, storage_path, content_type, caption").eq("kind", "supplier_invoice").in("ref_id", poIds).is("removed_at", null).order("created_at"),
    admin.from("purchase_orders").select("id, supplier_invoice_path, supplier_paid_at, supplier_paid_method, supplier_paid_reference").in("id", poIds),
    admin.from("purchase_order_lines").select("po_id, description, quantity, received_qty, unit_cost, invoice_unit_cost, invoice_check").in("po_id", poIds).eq("is_active", true).order("position"),
  ]);
  const paths = Array.from(new Set([...((files ?? []) as { storage_path: string }[]).map((f) => f.storage_path), ...((pos ?? []) as { supplier_invoice_path: string | null }[]).map((p) => p.supplier_invoice_path).filter((x): x is string => !!x)]));
  const urls = await signJobFiles(paths);
  const kinds = new Map(((files ?? []) as { storage_path: string; content_type: string | null }[]).map((f) => [f.storage_path, f.content_type ?? ""]));
  const isPdf = (p: string) => /pdf/i.test(kinds.get(p) ?? "") || /\.pdf$/i.test(p);
  const paid = ((pos ?? []) as { supplier_paid_at: string | null; supplier_paid_method: string | null; supplier_paid_reference: string | null }[]).find((p) => p.supplier_paid_at) ?? null;
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
          {paid ? <p className="text-sm text-green font-semibold">Paid to supplier {formatDateTime(paid.supplier_paid_at!)}{paid.supplier_paid_method ? ` · ${paid.supplier_paid_method}` : ""}{paid.supplier_paid_reference ? ` · ref ${paid.supplier_paid_reference}` : ""}</p> : null}
        </div>
      </div>
      {acts && row.status !== "waiting" ? (
        <div className="flex flex-wrap items-start gap-3 border-t border-line pt-3">
          {row.status === "new" || row.status === "queried" ? (
            <form action={checkInvoiceAction.bind(null, row.key)}>
              <Button type="submit" size="lg" data-si-check>Mark checked</Button>
            </form>
          ) : null}
          {row.status !== "paid" ? (
            <form action={queryInvoiceAction.bind(null, row.key)} className="flex flex-wrap items-center gap-2">
              <Input name="comment" required minLength={3} placeholder="What should Parts check?" className="w-72" textCase="sentence" disabled={!queryOn} aria-label="Query for the parts desk" data-si-query-text />
              <Button type="submit" size="lg" tone="secondary" disabled={!queryOn} data-si-query>Query with Parts</Button>
            </form>
          ) : null}
          {!queryOn ? <span className="text-xs text-muted">Query switches on with the database update (waiting for apply).</span> : null}
          {row.status !== "paid" ? <LinkButton href={`/parts/orders/${row.shares[0]?.poId}#paid`} tone="ghost" size="lg">Paid to supplier (on the LPO)</LinkButton> : null}
        </div>
      ) : null}
    </Card>
  );
}
