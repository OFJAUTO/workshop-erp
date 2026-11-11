import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { SupplierAmount } from "@/components/SupplierAmount";
import { SupplierPayBox } from "@/components/SupplierPayBox";
import { requireStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { formatDate } from "@/lib/format";
import { moneyFrom } from "@/lib/supplier-money";
import { advancesOf, openInvoicesOf } from "@/lib/supplier-payments";
import { METHOD_WORDS, loadPaymentsTab } from "@/lib/supplier-payments-tab";
import { SUPPLIER_PAY_METHODS, readZohoMap } from "@/lib/zoho-sync";

/**
 * SUPPLIER PAYMENTS (10 November 2026, Section 5): a tab of Parts management for the owner and accounts ONLY - hidden
 * from the menu for everyone else and refused by the server (404, so the page is never even named). What is due by
 * supplier (oldest first), record a payment with the existing box (method, amount, date, proof, one payment across
 * several invoices, advance or fee), the payment history, advances per supplier and the Excel export.
 */
const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function SupplierPaymentsPage({ searchParams }: { searchParams: Promise<{ supplier?: string; from?: string; to?: string }> }) {
  const staff = await requireStaff();
  if (!can(staff.role_id as RoleId, "supplierPayments")) notFound();
  const sp = await searchParams;
  const settings = await getSettings();
  const tab = await loadPaymentsTab({ from: sp.from ?? null, to: sp.to ?? null });
  const advanceOf = (id: string | null, name: string) => tab.advances.get(id ?? "") ?? tab.advances.get(name.toUpperCase()) ?? 0;
  const pick = sp.supplier ? tab.due.find((d) => (d.supplierId ?? `name:${d.supplier}`) === sp.supplier) ?? null : null;
  const canPay = !staff.viewingAs;
  const zmap = readZohoMap(settings);
  const paidFromWords = SUPPLIER_PAY_METHODS.map((m) => `${m.label}: ${zmap.paidFromBy?.[m.key] || zmap.paidFrom || "not mapped yet"}`).join(" · ");
  // eslint-disable-next-line react-hooks/purity
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const box = pick && tab.ready ? { invoices: await openInvoicesOf(pick.supplierId, pick.supplier), advances: await advancesOf(pick.supplierId, pick.supplier) } : null;
  const totalDue = tab.due.reduce((a, d) => a + d.total, 0);
  const exportHref = `/api/export/supplier-payments?${new URLSearchParams(Object.entries({ from: sp.from ?? "", to: sp.to ?? "" }).filter(([, v]) => v)).toString()}`;

  return (
    <div className="flex flex-col gap-4" data-supplier-payments>
      <PageHeader title="Supplier payments" subtitle="What is due to each supplier, oldest first. Record a payment across several invoices, with its proof." actions={<LinkButton href={exportHref} tone="secondary" size="md" data-sp-export>Export to Excel</LinkButton>} />
      {!tab.read ? <Notice tone="error">Couldn&apos;t read the supplier invoices just now: reload the page.</Notice> : null}
      {!tab.ready ? <Notice tone="info">Recording supplier payments switches on once the database change is applied.</Notice> : null}

      <Card className="flex flex-col gap-2" data-sp-due>
        <SectionLabel right={`AED ${money(totalDue)} incl. VAT`}>Due by supplier</SectionLabel>
        {tab.due.length === 0 ? <p className="text-sm text-muted">Nothing due to any supplier.</p> : null}
        <ul className="divide-y divide-line">
          {tab.due.map((d) => {
            const key = d.supplierId ?? `name:${d.supplier}`;
            const adv = advanceOf(d.supplierId, d.supplier);
            return (
              <li key={key} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${pick && key === (pick.supplierId ?? `name:${pick.supplier}`) ? "bg-chip -mx-2 px-2 rounded-control" : ""}`} data-sp-supplier={d.supplier}>
                <span className="font-extrabold uppercase">{d.supplier}</span>
                <span className="text-sm text-muted">{d.count} invoice{d.count === 1 ? "" : "s"}{d.oldest ? ` · oldest ${formatDate(d.oldest)}` : ""}</span>
                {adv > 0.005 ? <Badge tone="green">Advance AED {money(adv)}</Badge> : null}
                <span className="ml-auto" data-sp-due-amount={d.total.toFixed(2)}><SupplierAmount money={moneyFrom(d.net, d.vat, d.vatCharged)} size="sm" /></span>
                {canPay && tab.ready ? <LinkButton href={`/supplier-payments?supplier=${encodeURIComponent(key)}#pay`} size="md" data-sp-pay={d.supplier}>Record payment</LinkButton> : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {pick && box ? (
        <Card className="flex flex-col gap-3 scroll-mt-4" id="pay" data-sp-pay-card={pick.supplier}>
          <SectionLabel right={<Link href="/supplier-payments" className="text-sm font-bold underline underline-offset-4">Close</Link>}>Pay {pick.supplier}</SectionLabel>
          <SupplierPayBox key={`${pick.supplier}-${box.invoices.length}`} supplierId={pick.supplierId} supplierName={pick.supplier} invoices={box.invoices} advances={box.advances} today={today} paidFromWords={paidFromWords} proofScope={pick.supplierId ?? null} />
        </Card>
      ) : null}

      {tab.ready ? (
        <Card className="flex flex-col gap-2" data-sp-advances>
          <SectionLabel>Advances per supplier</SectionLabel>
          {Array.from(tab.advances.entries()).filter(([, v]) => v > 0.005).length === 0 ? <p className="text-sm text-muted">No advance held with any supplier.</p> : null}
          <ul className="flex flex-wrap gap-2">
            {Array.from(new Map(tab.history.filter((h) => h.status === "recorded").map((h) => [h.supplierId ?? h.supplier.toUpperCase(), h.supplier])).entries()).map(([k, name]) => {
              const v = tab.advances.get(k) ?? tab.advances.get(name.toUpperCase()) ?? 0;
              return v > 0.005 ? <li key={k} className="rounded-full border border-green bg-green-soft px-3 py-1 text-xs font-bold text-green-text" data-sp-advance={name}>{name} · AED {money(v)}</li> : null;
            })}
          </ul>
        </Card>
      ) : null}

      {tab.ready ? (
        <Card className="flex flex-col gap-2" data-sp-history>
          <SectionLabel>Payment history</SectionLabel>
          <form method="get" action="/supplier-payments" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">From<Input type="date" name="from" defaultValue={sp.from ?? ""} className="w-40" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">To<Input type="date" name="to" defaultValue={sp.to ?? ""} className="w-40" /></label>
            <Button type="submit" size="md" tone="secondary">Show</Button>
          </form>
          {tab.history.length === 0 ? <p className="text-sm text-muted">No supplier payments recorded yet.</p> : null}
          <ul className="divide-y divide-line">
            {tab.history.map((h) => (
              <li key={h.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm ${h.status === "void" ? "text-muted line-through" : ""}`} data-sp-history-row={h.number}>
                <span className="font-bold">{h.number}</span>
                <span className="font-semibold uppercase">{h.supplier}</span>
                <span className="text-muted">{formatDate(h.paidOn)} · {METHOD_WORDS[h.method] ?? h.method}{h.reference ? ` · ${h.reference}` : ""}</span>
                <span className="text-muted">{h.lpos.join(", ")}</span>
                {h.excessKind === "advance" ? <Badge tone="green">Includes advance</Badge> : null}
                {h.fee > 0.005 ? <Badge tone="outline">Fee AED {money(h.fee)}</Badge> : null}
                {!h.hasProof && h.status !== "void" ? <Badge tone="red">No proof</Badge> : null}
                {h.status === "void" ? <Badge tone="neutral">Void{h.voidReason ? `: ${h.voidReason}` : ""}</Badge> : null}
                <span className="ml-auto font-bold">AED {money(h.amount)}</span>
                {h.by ? <span className="basis-full text-xs text-muted">by {h.by}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
