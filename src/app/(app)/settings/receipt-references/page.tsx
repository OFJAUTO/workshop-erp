import { Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { refuse } from "@/lib/refusal";
import { receiptRefTypes } from "@/lib/receipts";
import { saveRefTypesAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Settings > Supplier references (15 November 2026): the references a delivery may be recorded with (Invoice number,
 * Pre-payment parts invoice number, WIP number and any added) and whether each COUNTS as the supplier's invoice. A
 * reference that does not count records the delivery, but the real invoice stays due. Owner and accounts.
 */
export default async function ReceiptReferencesPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  if (!["owner", "accounts"].includes(staff.role_id)) await refuse("no_permission", { path: "/settings/receipt-references" });
  const sp = await searchParams;
  const types = await receiptRefTypes();
  const readOnly = !!staff.viewingAs;
  return (
    <>
      <PageHeader title="Supplier references" subtitle="What the parts desk may type when a delivery arrives. Any one is enough to record it." actions={staff.role_id === "owner" ? <LinkButton href="/settings" tone="secondary" size="lg">Settings</LinkButton> : <LinkButton href="/supplier-invoices" tone="secondary" size="lg">Supplier invoices</LinkButton>} />
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
      {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      <Card className="flex flex-col gap-3">
        <SectionLabel>Reference types</SectionLabel>
        <p className="text-sm text-muted">Tick &quot;Counts as the supplier&apos;s invoice&quot; when that paper is the invoice itself. When it does not count (a WIP number), the delivery is recorded and the parts go to the technician, but the real invoice stays on &quot;Invoices not received&quot; until it comes.</p>
        <form action={saveRefTypesAction} className="flex flex-col gap-3" data-ref-types-form>
          <ul className="flex flex-col divide-y divide-line">
            {types.map((t, i) => (
              <li key={t.key} className="flex flex-wrap items-center gap-3 py-2" data-ref-type-row={t.key}>
                <input type="hidden" name="key" value={t.key} />
                {t.builtin ? <span className="min-w-56 font-semibold">{t.label}<input type="hidden" name={`label__${t.key}`} value={t.label} /></span> : <Input name={`label__${t.key}`} defaultValue={t.label} aria-label={`Name of reference type ${i + 1}`} style={{ width: "18rem" }} />}
                <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" name={`counts__${t.key}`} defaultChecked={t.counts} disabled={readOnly} className="h-5 w-5" data-ref-type-counts={t.key} />
                  Counts as the supplier&apos;s invoice
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 rounded-control bg-surface p-3">
            <Input name="new_label" placeholder="Add a type, for example Delivery note number" aria-label="New reference type" style={{ width: "20rem" }} data-ref-type-new />
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="new_counts" className="h-5 w-5" /> Counts as the supplier&apos;s invoice</label>
          </div>
          {readOnly ? <p className="text-sm text-muted">View as is read-only.</p> : <div><Button type="submit" size="md" data-ref-types-save>Save</Button></div>}
        </form>
      </Card>
    </>
  );
}
