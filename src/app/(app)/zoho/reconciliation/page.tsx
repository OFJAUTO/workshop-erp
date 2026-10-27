import { Badge, Button, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReconDetails } from "@/lib/zoho-reconcile";
import { backfillReconciliation, recheckDay } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The daily reconciliation (phase 4): one line per day — yesterday per the ERP next to yesterday per Zoho.
 * Green when identical; red names the exact difference. The morning cron writes each new day by itself.
 */

const aed = (n: number) => `AED ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

export default async function ZohoReconciliationPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("zohoSync");
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const { data } = await admin.from("zoho_reconciliation").select("day, status, details, checked_at").order("day", { ascending: false }).limit(120);
  const rows = ((data ?? []) as { day: string; status: "green" | "red"; details: ReconDetails; checked_at: string }[]).map((r) => ({ ...r, day: String(r.day).slice(0, 10) }));

  return (
    <>
      <PageHeader
        title="Zoho reconciliation"
        subtitle="Every morning, yesterday per the ERP next to yesterday per Zoho: tax invoices, payments by method, credit notes, supplier bills, supplier payments and expenses. Green = identical; red names the exact difference."
        actions={<LinkButton href="/zoho" tone="secondary">Back to the sync page</LinkButton>}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {!staff.viewingAs ? (
        <Card className="flex flex-wrap items-center gap-2" data-recon-controls>
          <form action={backfillReconciliation}>
            <Button type="submit" size="md" data-recon-backfill>Check every missing day</Button>
          </form>
          <span className="text-xs text-muted">The first sync run after midnight checks the new day by itself.</span>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-1" data-recon-rows>
        <SectionLabel right={String(rows.length)}>Days</SectionLabel>
        {!rows.length ? (
          <Empty title="No days checked yet">Press &quot;Check every missing day&quot; to compare the whole OFJ TEST period.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const reds = (r.details?.sections ?? []).filter((s) => !s.ok);
              const modeReds = Object.entries(r.details?.paymentsByMode ?? {}).filter(([, m]) => !m.ok);
              return (
                <li key={r.day} className="py-3 flex flex-col gap-1.5" data-recon-day={r.day} data-recon-status={r.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{r.day}</span>
                    {r.status === "green" ? <Badge tone="green">Identical ✓</Badge> : <Badge tone="red">Differs</Badge>}
                    <span className="flex-1" />
                    {!staff.viewingAs ? (
                      <form action={recheckDay.bind(null, r.day)}>
                        <Button type="submit" tone="secondary" size="md" data-recon-recheck>Re-check</Button>
                      </form>
                    ) : null}
                  </div>
                  {r.status === "green" ? (
                    <p className="text-xs text-muted">
                      {(r.details?.sections ?? []).map((s) => `${s.label}: ${s.erp.count} · ${aed(s.erp.total)}`).join("  ·  ")}
                      {r.details?.deposits?.count ? `  ·  of the payments, ${r.details.deposits.count} deposit${r.details.deposits.count === 1 ? "" : "s"} (${aed(r.details.deposits.total)})` : ""}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1" data-recon-diffs>
                      {reds.map((s) => (
                        <p key={s.label} className="text-sm font-semibold text-red">{s.label}: {s.diff}</p>
                      ))}
                      {modeReds.map(([mode, m]) => (
                        <p key={mode} className="text-sm font-semibold text-red">Payments by {mode}: {aed(m.erp)} in the ERP vs {aed(m.zoho)} in Zoho</p>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted">Deposits are ordinary payments in Zoho (counted inside Payments). Supplier credits and customer refunds show inside the bills&apos; and credit notes&apos; balances rather than as their own lines.</p>
      </Card>
    </>
  );
}
