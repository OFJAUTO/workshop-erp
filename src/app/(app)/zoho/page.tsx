import Link from "next/link";
import { Badge, Button, Card, Empty, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { zohoOpenUrl, zohoWriteOrg, type OutboxRow, type ZohoKind } from "@/lib/zoho-sync";
import { ZOHO_REAL_ORG_ID } from "@/lib/zoho";
import { backfillZoho, markZohoDoneByHand, retryZohoRow, syncZohoNow, tickGoLiveReview } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The Zoho Books sync page (phase 1, owner and accounts): what is waiting, what posted with the matching figures,
 * and what failed with the reason in plain words. Reads the ERP's own database only — Zoho is never read here.
 */

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Waiting" },
  { key: "failed", label: "Failed" },
  { key: "synced", label: "Posted" },
] as const;

const KIND_WORDS: Record<ZohoKind, string> = {
  contact: "Customer",
  deposit: "Deposit",
  invoice: "Tax invoice",
  payment: "Payment",
  creditnote: "Credit note",
  vendor: "Supplier",
  bill: "Supplier bill",
  billpayment: "Supplier payment",
  commission: "Commission",
  recovery: "Recovery month",
  vendorcredit: "Supplier credit",
  cnrefund: "Customer refund",
};

const aed = (n: number) => `AED ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

function resultWords(row: OutboxRow): string | null {
  const r = row.zoho_result as Record<string, unknown> | null;
  if (!r) return null;
  if (r.manual === true) return `Done by hand by ${String(r.name ?? "accounts")} on ${String(r.at ?? "").slice(0, 10)}: ${String(r.note ?? "")}`;
  if (typeof r.skipped === "string") return r.skipped;
  if (row.kind === "invoice") {
    const z = r.zoho as { total?: number; vat?: number; balance?: number } | undefined;
    if (!z) return null;
    return `In Zoho: ${aed(z.total ?? 0)} · VAT ${aed(z.vat ?? 0)} · balance ${aed(z.balance ?? 0)} — matches the ERP to the fils`;
  }
  if (row.kind === "creditnote") {
    const z = r.zoho as { total?: number; unapplied?: number } | undefined;
    if (!z) return null;
    return `Credit note in Zoho: ${aed(z.total ?? 0)} · applied to ${String(r.applied_to ?? "the invoice")}${typeof r.invoice_balance_after === "number" ? ` · invoice balance now ${aed(r.invoice_balance_after)}` : ""}`;
  }
  if (row.kind === "bill") {
    const z = r.zoho as { net?: number; vat?: number; total?: number; balance?: number } | undefined;
    if (!z) return null;
    return `Bill in Zoho: ${aed(z.net ?? 0)} + VAT ${aed(z.vat ?? 0)} = ${aed(z.total ?? 0)} · due ${aed(z.balance ?? 0)}${r.attached ? " · scan attached" : ""}${r.price_flags ? ` · ${r.price_flags} price flag(s) in the notes` : ""} — matches the ERP to the fils`;
  }
  if (row.kind === "billpayment") {
    return `Paid in Zoho${typeof r.amount === "number" ? `: ${aed(r.amount)}` : ""} · the bill shows ${aed(Number(r.bill_balance_after) || 0)} due`;
  }
  if (row.kind === "vendorcredit") {
    const z = r.zoho as { total?: number; unapplied?: number } | undefined;
    if (!z) return null;
    return `Supplier credit in Zoho: ${aed(z.total ?? 0)}${typeof r.applied_now === "number" && r.applied_now > 0 ? ` · ${aed(r.applied_now)} applied to the bill` : ""}${typeof r.bill_balance_after === "number" ? ` · the bill shows ${aed(r.bill_balance_after)} due` : ""}`;
  }
  if (row.kind === "cnrefund") {
    return `Refund in Zoho${typeof r.refund === "number" ? `: ${aed(r.refund)}` : ""}${typeof r.cn_unapplied_after === "number" ? ` · ${aed(r.cn_unapplied_after)} of the credit left unapplied` : ""}`;
  }
  if (row.kind === "commission" || row.kind === "recovery") {
    const amount = typeof r.amount === "number" ? aed(r.amount) : "";
    return `Expense in Zoho: ${amount}${r.receipt ? " · proof attached" : typeof r.note === "string" ? ` · ${r.note}` : ""}`;
  }
  const amount = typeof r.amount === "number" ? aed(r.amount) : null;
  const charge = typeof r.bank_charges === "number" && r.bank_charges > 0 ? ` · bank charge ${aed(r.bank_charges)}` : "";
  return amount ? `${r.kind === "advance" ? "Advance" : "Payment"} in Zoho: ${amount}${charge}` : null;
}

export default async function ZohoSyncPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; show?: string }> }) {
  const staff = await requirePermission("zohoSync");
  const { message, error, show: showRaw } = await searchParams;
  const show = FILTERS.some((f) => f.key === showRaw) ? (showRaw as (typeof FILTERS)[number]["key"]) : "all";
  const admin = createAdminClient();
  const [settings, org, { data: rowsRaw }] = await Promise.all([
    getSettings(),
    zohoWriteOrg(),
    admin.from("zoho_outbox").select("id, kind, record_id, job_id, status, attempts, last_error, zoho_id, zoho_result, enqueued_at, synced_at").order("enqueued_at", { ascending: false }).limit(400),
  ]);
  const rows = (rowsRaw ?? []) as OutboxRow[];

  // The document names, batched per kind: INV-xxxxx, RCT-xxxxx, LPO-xxxxx, CPV-xxxxx or the person's name.
  const names = new Map<string, string>();
  const idsOf = (...kinds: ZohoKind[]) => rows.filter((r) => kinds.includes(r.kind)).map((r) => r.record_id);
  const invoiceIds = idsOf("invoice", "creditnote");
  const paymentIds = idsOf("deposit", "payment");
  const customerIds = idsOf("contact");
  const supplierIds = idsOf("vendor");
  const poIds = idsOf("bill", "billpayment");
  const voucherIds = idsOf("commission");
  const payoutIds = idsOf("recovery");
  const partIds = idsOf("vendorcredit");
  const refundIds = idsOf("cnrefund");
  if (invoiceIds.length)
    for (const i of (await admin.from("invoices").select("id, number, total_aed").in("id", invoiceIds)).data ?? []) {
      names.set(`invoice:${i.id}`, `${i.number} · ${aed(Number(i.total_aed))}`);
      names.set(`creditnote:${i.id}`, `${i.number} · ${aed(Number(i.total_aed))}`);
    }
  if (paymentIds.length)
    for (const p of (await admin.from("payments").select("id, number, amount_aed").in("id", paymentIds)).data ?? []) {
      names.set(`deposit:${p.id}`, `${p.number} · ${aed(Number(p.amount_aed))}`);
      names.set(`payment:${p.id}`, `${p.number} · ${aed(Number(p.amount_aed))}`);
    }
  if (customerIds.length) for (const c of (await admin.from("customers").select("id, full_name, company_name").in("id", customerIds)).data ?? []) names.set(`contact:${c.id}`, String(c.company_name || c.full_name));
  if (supplierIds.length) for (const s of (await admin.from("suppliers").select("id, name").in("id", supplierIds)).data ?? []) names.set(`vendor:${s.id}`, String(s.name));
  if (poIds.length)
    for (const po of (await admin.from("purchase_orders").select("id, number, supplier_name, supplier_invoice_number").in("id", poIds)).data ?? []) {
      names.set(`bill:${po.id}`, `${po.supplier_invoice_number ?? po.number} · ${po.supplier_name}`);
      names.set(`billpayment:${po.id}`, `${po.number} · ${po.supplier_name}`);
    }
  if (voucherIds.length) for (const v of (await admin.from("commission_payments").select("id, number, recipient, amount_aed").in("id", voucherIds)).data ?? []) names.set(`commission:${v.id}`, `${v.number} · ${v.recipient} · ${aed(Number(v.amount_aed))}`);
  if (payoutIds.length) for (const r of (await admin.from("recovery_payouts").select("id, who, month, total_aed").in("id", payoutIds)).data ?? []) names.set(`recovery:${r.id}`, `${r.month} · ${r.who} · ${aed(Number(r.total_aed))}`);
  if (partIds.length) for (const pt of (await admin.from("part_items").select("id, description, supplier").in("id", partIds)).data ?? []) names.set(`vendorcredit:${pt.id}`, `${pt.description}${pt.supplier ? ` · ${pt.supplier}` : ""}`);
  if (refundIds.length) for (const rf of (await admin.from("invoices").select("id, number, refund_amount_aed, total_aed").in("id", refundIds)).data ?? []) names.set(`cnrefund:${rf.id}`, `${rf.number} · ${aed(Number(rf.refund_amount_aed ?? rf.total_aed))}`);

  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, f.key === "all" ? rows.length : rows.filter((r) => r.status === f.key).length]));
  const filtered = show === "all" ? rows : rows.filter((r) => r.status === show);
  const live = settings.zoho_live_enabled === true;

  return (
    <>
      <PageHeader
        title="Zoho Books sync"
        subtitle={`One-way: the ERP posts customers, deposits, tax invoices and payments to Zoho. ${live ? "LIVE: writes go to the REAL organization." : `Writes go to OFJ TEST only (${org ?? "no test organization picked"}); the REAL book (${ZOHO_REAL_ORG_ID}) stays read-only until go-live.`}`}
        actions={
          <span className="flex flex-wrap gap-2">
            <LinkButton href="/zoho/reconciliation" tone="secondary">Reconciliation</LinkButton>
            <LinkButton href="/zoho/close" tone="secondary">Monthly close</LinkButton>
            <LinkButton href="/settings/zoho/mapping" tone="secondary">Account mapping</LinkButton>
          </span>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card className="flex flex-wrap items-center gap-2" data-zoho-controls>
        {!staff.viewingAs ? (
          <form action={syncZohoNow}>
            <Button type="submit" size="md" data-zoho-sync-now>Sync now</Button>
          </form>
        ) : null}
        {staff.role_id === "owner" && !staff.viewingAs ? (
          <form action={backfillZoho}>
            <Button type="submit" tone="secondary" size="md" data-zoho-backfill>Backfill: queue everything already in the ERP</Button>
          </form>
        ) : null}
        <span className="text-xs text-muted">The sync also runs by itself every five minutes.</span>
      </Card>

      {staff.role_id === "accounts" && !staff.viewingAs
        ? await (async () => {
            // Phase 4: Mathew's own tick that the OFJ TEST side-by-side review is done (one of the go-live gates).
            const reviewed = (settings.zoho_golive_reviewed ?? {}) as { name?: string; at?: string };
            return (
              <Card className="flex flex-wrap items-center gap-3" data-golive-review>
                <SectionLabel>Go-live review</SectionLabel>
                {reviewed.at ? (
                  <p className="text-sm font-semibold text-green" data-golive-reviewed>Reviewed side by side by {reviewed.name ?? "accounts"} on {String(reviewed.at).slice(0, 10)}.</p>
                ) : (
                  <form action={tickGoLiveReview} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted">Once OFJ TEST matches the ERP side by side, tick it here — the owner&apos;s go-live checklist turns green.</span>
                    <Button type="submit" size="md" data-golive-tick>The review is done</Button>
                  </form>
                )}
              </Card>
            );
          })()
        : null}

      <div className="flex flex-wrap gap-1 text-xs font-bold" data-zoho-filters>
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/zoho?show=${f.key}`} className={`min-h-9 inline-flex items-center rounded-control px-3 ${show === f.key ? "bg-ink text-white" : "bg-chip"}`} data-filter={f.key}>
            {f.label} · {counts[f.key]}
          </Link>
        ))}
      </div>

      <Card className="flex flex-col gap-1" data-zoho-rows>
        <SectionLabel right={String(filtered.length)}>Documents</SectionLabel>
        {!filtered.length ? (
          <Empty title="Nothing here">{show === "failed" ? "No failures. Everything that was queued has posted or is waiting its turn." : "Nothing queued yet. Recording a payment, a deposit or a tax invoice queues it by itself; Backfill queues what already exists."}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((r) => {
              const name = names.get(`${r.kind}:${r.record_id}`) ?? r.record_id.slice(0, 8);
              const words = resultWords(r);
              return (
                <li key={r.id} className="py-3 flex flex-col gap-1.5" data-zoho-row={r.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="outline">{KIND_WORDS[r.kind]}</Badge>
                    <span className="font-bold">{name}</span>
                    <span className="flex-1" />
                    {r.status === "synced" ? <Badge tone="green">Posted ✓</Badge> : r.status === "failed" ? <Badge tone="red">Failed</Badge> : <Badge tone="amber">Waiting</Badge>}
                  </div>
                  <p className="text-xs text-muted">
                    Queued {formatDateTime(r.enqueued_at)}
                    {r.synced_at ? ` · posted ${formatDateTime(r.synced_at)}` : ""}
                    {r.attempts > 1 ? ` · ${r.attempts} tries` : ""}
                  </p>
                  {words ? <p className="text-sm font-semibold text-green" data-zoho-result>{words}</p> : null}
                  {r.last_error && r.status !== "synced" ? <p className="text-sm text-red font-semibold" data-zoho-reason>{r.last_error}</p> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {r.zoho_id && org ? (
                      <a className="text-sm font-bold underline" href={zohoOpenUrl(org, r.kind, r.zoho_id)} target="_blank" rel="noreferrer" data-zoho-open>
                        Open in Zoho
                      </a>
                    ) : null}
                    {r.status === "failed" && !staff.viewingAs ? (
                      <form action={retryZohoRow.bind(null, r.id)}>
                        <Button type="submit" tone="secondary" size="md" data-zoho-retry>Retry</Button>
                      </form>
                    ) : null}
                  </div>
                  {r.status === "failed" && !staff.viewingAs ? (
                    <details className="text-sm" data-zoho-by-hand>
                      <summary className="cursor-pointer font-bold min-h-11 inline-flex items-center">Done by hand in Zoho…</summary>
                      <form action={markZohoDoneByHand.bind(null, r.id)} className="flex flex-wrap items-end gap-2 pt-1">
                        <span className="flex-1 min-w-60">
                          <Input name="note" placeholder="What was done in Zoho (e.g. entered by hand as INV-123)" aria-label="What was done in Zoho" data-zoho-by-hand-note />
                        </span>
                        <Button type="submit" size="md" data-zoho-by-hand-save>Close the row</Button>
                      </form>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
