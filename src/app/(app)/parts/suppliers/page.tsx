import { Badge, Button, Card, Empty, Field, Input, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { addSupplier, setSupplierActive, updateSupplier } from "./actions";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Supplier = { id: string; name: string; trn: string | null; phone: string | null; email: string | null; address: string | null; payment_terms: string | null; notes: string | null; is_active: boolean; default_discount_percent: number | null; discount_by_type: Record<string, number> | null };

function SupplierFields({ s, types, canDiscount }: { s?: Supplier; types: string[]; canDiscount: boolean }) {
  const byType = (s?.discount_by_type ?? {}) as Record<string, number>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2 rounded-control bg-chip p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Discount % (default)<Input name="discount_default" defaultValue={s?.default_discount_percent === null || s?.default_discount_percent === undefined ? "0" : String(s.default_discount_percent)} inputMode="decimal" disabled={!canDiscount} /></label>
        {types.map((t) => (
          <label key={t} className="flex flex-col gap-1 text-xs font-semibold text-muted">{t[0].toUpperCase() + t.slice(1)} parts %<Input name={`discount__${t}`} defaultValue={byType[t] === undefined ? "" : String(byType[t])} inputMode="decimal" placeholder="default" disabled={!canDiscount} /></label>
        ))}
        <span className="col-span-2 sm:col-span-4 text-[11px] text-muted">Parts enter the list price; the discount gives the net cost. {canDiscount ? "A box left empty uses the default." : "The owner and accounts set the discounts."}</span>
      </div>
      <Field label="Name"><Input name="name" defaultValue={s?.name ?? ""} required textCase="title" /></Field>
      <Field label="TRN" optional hint="15 digits"><Input name="trn" defaultValue={s?.trn ?? ""} inputMode="numeric" maxLength={15} /></Field>
      <Field label="Phone" optional><Input name="phone" defaultValue={s?.phone ?? ""} inputMode="tel" /></Field>
      <Field label="Email" optional><Input name="email" defaultValue={s?.email ?? ""} type="email" /></Field>
      <div className="sm:col-span-2"><Field label="Address" optional><Input name="address" defaultValue={s?.address ?? ""} textCase="sentence" /></Field></div>
      <Field label="Payment terms" optional hint="For example: 30 days, or cash on delivery"><Input name="payment_terms" defaultValue={s?.payment_terms ?? ""} textCase="sentence" /></Field>
      <Field label="Notes" optional><Textarea name="notes" defaultValue={s?.notes ?? ""} rows={2} textCase="sentence" /></Field>
    </div>
  );
}

/** The supplier list: LPOs and supplier invoices pick from it. Parts and accounts keep it. */
export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; show?: string }> }) {
  const staff = await requirePermission("manageSuppliers");
  const canDiscount = staff.role_id === "owner" || staff.role_id === "accounts";
  const { message, error, show } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const types = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  const { data } = await admin.from("suppliers").select("id, name, trn, phone, email, address, payment_terms, notes, is_active, default_discount_percent, discount_by_type").order("name");
  const all = (data ?? []) as Supplier[];
  const list = show === "all" ? all : all.filter((s) => s.is_active);
  return (
    <>
      <PageHeader title="Suppliers" subtitle="Name, TRN, phone, email, address and payment terms. LPOs and supplier invoices pick from this list." />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card className="flex flex-col gap-3">
        <SectionLabel>Add a supplier</SectionLabel>
        <form action={addSupplier} className="flex flex-col gap-3">
          <SupplierFields types={types} canDiscount={canDiscount} />
          <div><Button type="submit" size="md">Add supplier</Button></div>
        </form>
      </Card>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SectionLabel right={`${list.length}`}>Suppliers</SectionLabel>
          <a href={show === "all" ? "/parts/suppliers" : "/parts/suppliers?show=all"} className="ml-auto text-xs font-bold underline underline-offset-4">{show === "all" ? "Hide inactive" : "Show inactive too"}</a>
        </div>
        {list.length === 0 ? <Empty title="No suppliers yet">Add the first one above. A supplier typed on an LPO is added here by itself.</Empty> : null}
        {list.map((s) => (
          <Card key={s.id} className="flex flex-col gap-2">
            <details>
              <summary className="list-none cursor-pointer min-h-11 flex flex-wrap items-center gap-3">
                <span className="font-extrabold">{s.name}</span>
                {!s.is_active ? <Badge tone="neutral">Inactive</Badge> : null}
                <span className="text-sm text-muted">{[s.trn ? `TRN ${s.trn}` : null, s.phone, s.payment_terms, s.default_discount_percent ? `${s.default_discount_percent}% discount` : null].filter(Boolean).join(" · ") || "No details yet"}</span>
                <span className="ml-auto text-xs font-bold text-muted underline underline-offset-4">Edit</span>
              </summary>
              <form action={updateSupplier.bind(null, s.id)} className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                <SupplierFields s={s} types={types} canDiscount={canDiscount} />
                <div className="flex flex-wrap gap-2"><Button type="submit" size="md">Save</Button></div>
              </form>
              <form action={setSupplierActive.bind(null, s.id)} className="mt-2">
                <input type="hidden" name="active" value={s.is_active ? "no" : "yes"} />
                <Button type="submit" tone="ghost" size="md">{s.is_active ? "Take off the list" : "Put back on the list"}</Button>
              </form>
            </details>
          </Card>
        ))}
      </section>
    </>
  );
}
