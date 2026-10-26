import Link from "next/link";
import { Badge, Button, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { zohoOpenUrl, zohoWriteOrg, type OutboxRow, type ZohoKind } from "@/lib/zoho-sync";
import { ZOHO_REAL_ORG_ID } from "@/lib/zoho";
import { backfillZoho, retryZohoRow, syncZohoNow } from "./actions";

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

const KIND_WORDS: Record<ZohoKind, string> = { contact: "Customer", deposit: "Deposit", invoice: "Tax invoice", payment: "Payment" };

const aed = (n: number) => `AED ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

function resultWords(row: OutboxRow): string | null {
  const r = row.zoho_result as Record<string, unknown> | null;
  if (!r) return null;
  if (typeof r.skipped === "string") return r.skipped;
  if (row.kind === "invoice") {
    const z = r.zoho as { total?: number; vat?: number; balance?: number } | undefined;
    if (!z) return null;
    return `In Zoho: ${aed(z.total ?? 0)} · VAT ${aed(z.vat ?? 0)} · balance ${aed(z.balance ?? 0)} — matches the ERP to the fils`;
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

  // The document names, batched per kind: INV-xxxxx, RCT-xxxxx or the customer's name.
  const names = new Map<string, string>();
  const invoiceIds = rows.filter((r) => r.kind === "invoice").map((r) => r.record_id);
  const paymentIds = rows.filter((r) => r.kind === "deposit" || r.kind === "payment").map((r) => r.record_id);
  const customerIds = rows.filter((r) => r.kind === "contact").map((r) => r.record_id);
  if (invoiceIds.length) for (const i of (await admin.from("invoices").select("id, number, total_aed").in("id", invoiceIds)).data ?? []) names.set(`invoice:${i.id}`, `${i.number} · ${aed(Number(i.total_aed))}`);
  if (paymentIds.length)
    for (const p of (await admin.from("payments").select("id, number, amount_aed").in("id", paymentIds)).data ?? []) {
      names.set(`deposit:${p.id}`, `${p.number} · ${aed(Number(p.amount_aed))}`);
      names.set(`payment:${p.id}`, `${p.number} · ${aed(Number(p.amount_aed))}`);
    }
  if (customerIds.length) for (const c of (await admin.from("customers").select("id, full_name, company_name").in("id", customerIds)).data ?? []) names.set(`contact:${c.id}`, String(c.company_name || c.full_name));

  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, f.key === "all" ? rows.length : rows.filter((r) => r.status === f.key).length]));
  const filtered = show === "all" ? rows : rows.filter((r) => r.status === show);
  const live = settings.zoho_live_enabled === true;

  return (
    <>
      <PageHeader
        title="Zoho Books sync"
        subtitle={`One-way: the ERP posts customers, deposits, tax invoices and payments to Zoho. ${live ? "LIVE: writes go to the REAL organization." : `Writes go to OFJ TEST only (${org ?? "no test organization picked"}); the REAL book (${ZOHO_REAL_ORG_ID}) stays read-only until go-live.`}`}
        actions={<LinkButton href="/settings/zoho/mapping" tone="secondary">Account mapping</LinkButton>}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card className="flex flex-wrap items-center gap-2" data-zoho-controls>
        <form action={syncZohoNow}>
          <Button type="submit" size="md" data-zoho-sync-now>Sync now</Button>
        </form>
        {staff.role_id === "owner" ? (
          <form action={backfillZoho}>
            <Button type="submit" tone="secondary" size="md" data-zoho-backfill>Backfill: queue everything already in the ERP</Button>
          </form>
        ) : null}
        <span className="text-xs text-muted">The sync also runs by itself every five minutes.</span>
      </Card>

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
                    {r.status === "failed" ? (
                      <form action={retryZohoRow.bind(null, r.id)}>
                        <Button type="submit" tone="secondary" size="md" data-zoho-retry>Retry</Button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
