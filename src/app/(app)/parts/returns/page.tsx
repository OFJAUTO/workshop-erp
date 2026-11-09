import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { Card, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { LiveRefresh } from "@/components/LiveRefresh";
import { loadPurchaseReturns, purchaseReturnsReady, RETURN_TABS } from "@/lib/purchase-returns";
import { ReturnRow } from "./ReturnRow";

export const dynamic = "force-dynamic";

/**
 * PURCHASE RETURNS (8 November 2026, Section 8): Parts management → Purchase returns. Every part going back to a
 * supplier, from the request to its outcome, in four tabs: Waiting to go back / Waiting for credit (days counting) /
 * Done / Refused. Parts send it back; accounts record the credit or refund; the owner decides write-offs.
 */
export default async function PurchaseReturnsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "managePurchaseOrders") || role === "accounts" || role === "owner")) notFound();
  const { tab: rawTab } = await searchParams;
  const tab = RETURN_TABS.find((t) => t.key === rawTab) ?? RETURN_TABS[0];
  const ready = await purchaseReturnsReady();
  const all = ready ? await loadPurchaseReturns() : [];
  const counts = Object.fromEntries(RETURN_TABS.map((t) => [t.key, all.filter((r) => (t.statuses as readonly string[]).includes(r.status)).length]));
  const shown = all.filter((r) => (tab.statuses as readonly string[]).includes(r.status));
  // eslint-disable-next-line react-hooks/purity -- a server page: the clock is read once per request
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const canParts = can(role, "managePurchaseOrders") && !staff.viewingAs;
  const canMoney = (role === "owner" || role === "accounts") && !staff.viewingAs;
  const expected = all.filter((r) => r.status === "requested" || r.status === "sent").reduce((a, r) => a + r.expected, 0);
  return (
    <>
      <LiveRefresh tables={["part_items"]} />
      <PageHeader title="Purchase returns" subtitle="Parts going back to their supplier, from the return note to the credit. The supplier balance only moves when accounts record the credit or the refund." />
      {!ready ? <Notice tone="info">Purchase returns switch on with the database update (waiting for apply). Returns made meanwhile are still tracked on Returns and leftovers.</Notice> : null}
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1 text-xs font-bold" data-return-tabs>
          {RETURN_TABS.map((t) => (
            <Link key={t.key} href={`/parts/returns?tab=${t.key}`} className={`min-h-9 inline-flex items-center rounded-control px-3 ${tab.key === t.key ? "bg-ink text-on-dark" : "bg-chip"}`} data-return-tab={t.key}>{t.label} · {counts[t.key]}</Link>
          ))}
        </div>
        {expected > 0 ? <p className="text-sm font-bold" data-return-expected-total>Credit expected in all: AED {expected.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (not in any supplier balance until it is recorded)</p> : null}
        <SectionLabel right={`${shown.length}`}>{tab.label}</SectionLabel>
        {shown.length ? (
          <ul className="divide-y divide-line" data-return-list>
            {shown.map((r) => <ReturnRow key={r.id} r={r} today={today} canParts={canParts} canMoney={canMoney} isOwner={role === "owner" && !staff.viewingAs} />)}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing here.</p>
        )}
      </Card>
    </>
  );
}
