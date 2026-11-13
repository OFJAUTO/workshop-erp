import { refuse } from "@/lib/refusal";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LinkButton, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { invoiceFilterParams } from "@/lib/supplier-invoice-rows";
import { SupplierInvoicesView, type SiSearch } from "./SupplierInvoicesView";

/**
 * SUPPLIER INVOICES (1 November 2026): one clean row per supplier invoice with its LPOs and cars. Since 3 November the
 * body is the shared SupplierInvoicesView, also the Supplier invoices tab of Parts accounts; this page keeps its menu
 * link, its addresses (notifications, Waiting on you, the job card) and the parts desk's access. The view shows the
 * answer of Mark checked / Query itself, next to those buttons.
 */
export default async function SupplierInvoicesPage({ searchParams }: { searchParams: Promise<SiSearch> }) {
  const staff = await requireStaff();
  if (!["owner", "accounts", "parts"].includes(staff.role_id)) return refuse("no_permission");
  const sp = await searchParams;
  // THE filters of the screen, so the file holds exactly what the screen shows.
  const params = new URLSearchParams(invoiceFilterParams(sp));
  const partsAccounts = can(staff.role_id as RoleId, "viewPartsAccounts");

  return (
    <>
      <LiveRefresh tables={["purchase_orders"]} />
      <PageHeader
        title="Supplier invoices"
        subtitle="Every supplier invoice with its LPOs and cars. Accounts check it (the bill then goes to Zoho Books) or query it back to Parts."
        actions={
          <>
            {partsAccounts ? <LinkButton href="/parts-accounts?tab=invoices" tone="ghost" size="lg" data-si-parts-accounts>Parts accounts</LinkButton> : null}
            <LinkButton href={`/api/export/supplier-invoices?${params.toString()}`} tone="secondary" size="lg" data-si-export>Export to Excel</LinkButton>
          </>
        }
      />
      <SupplierInvoicesView sp={sp} staff={staff} place="supplier-invoices" />
    </>
  );
}
