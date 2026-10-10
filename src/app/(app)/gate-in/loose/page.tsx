import Link from "next/link";
import { Badge, Button, Card, Input, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { ITEM_TYPES } from "@/lib/loose-items";
import { createClient } from "@/lib/supabase/server";
import { createLooseGateIn } from "../loose-actions";
import { LooseItemsForm } from "./LooseItemsForm";

export const dynamic = "force-dynamic";

type CustomerRow = { id: string; full_name: string; company_name: string | null; phone: string; is_vip: boolean };

/** Gate-in without a car: find or add the customer, then list the items. */
export default async function LooseGateInPage({ searchParams }: { searchParams: Promise<{ q?: string; customer?: string; new?: string }> }) {
  await requirePermission("gateIn");
  const { q = "", customer: customerId, new: isNew } = await searchParams;
  const supabase = await createClient();
  let chosen: CustomerRow | null = null;
  if (customerId) {
    const { data } = await supabase.from("customers").select("id, full_name, company_name, phone, is_vip").eq("id", customerId).maybeSingle();
    chosen = (data as CustomerRow | null) ?? null;
  }
  let results: CustomerRow[] = [];
  const term = q.trim();
  if (!chosen && !isNew && term) {
    const like = `%${term.replace(/[%_]/g, "")}%`;
    const digits = term.replace(/[^\d]/g, "");
    const parts = [`full_name.ilike.${like}`, `company_name.ilike.${like}`, `customer_number.ilike.${like}`];
    if (digits.length >= 3) parts.push(`phone.ilike.%${digits}%`);
    const { data } = await supabase.from("customers").select("id, full_name, company_name, phone, is_vip").eq("is_active", true).or(parts.join(",")).order("full_name").limit(12);
    results = (data ?? []) as CustomerRow[];
  }
  const showForm = !!chosen || isNew === "1";
  return (
    <>
      <PageHeader title="Gate in loose items" subtitle="Wheels, an engine, a bumper: items that arrive without a car. No inspection report and no wash; the quotation is the approval." actions={<LinkButton href="/gate-in" tone="secondary" size="lg">Gate in a car instead</LinkButton>} />
      {!showForm ? (
        <Card className="flex flex-col gap-4">
          <SectionLabel>Whose items are they?</SectionLabel>
          <form className="flex flex-wrap gap-2" action="/gate-in/loose">
            <Input name="q" defaultValue={q} placeholder="Customer name or phone" className="max-w-md text-lg font-bold" autoFocus />
            <Button type="submit" size="lg">Search</Button>
            <LinkButton href="/gate-in/loose?new=1" tone="secondary" size="lg">New customer</LinkButton>
          </form>
          {term && results.length === 0 ? <p className="text-sm text-muted">No customer matches. <Link href="/gate-in/loose?new=1" className="underline underline-offset-4 font-semibold">Add a new customer</Link>.</p> : null}
          {results.length ? (
            <ul className="divide-y divide-line">
              {results.map((c) => (
                <li key={c.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                  <span className="flex flex-col">
                    <span className="font-bold flex items-center gap-2">{c.company_name ?? c.full_name}{c.is_vip ? <Badge tone="ink">VIP</Badge> : null}</span>
                    <span className="text-xs text-muted">{c.company_name ? `${c.full_name} · ` : ""}{c.phone}</span>
                  </span>
                  <LinkButton href={`/gate-in/loose?customer=${c.id}`} size="md">Choose</LinkButton>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : (
        <Card className="flex flex-col gap-4 max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>The items</SectionLabel>
            <Link href="/gate-in/loose" className="text-xs font-semibold underline underline-offset-4">Change customer</Link>
          </div>
          <LooseItemsForm action={createLooseGateIn} itemTypes={ITEM_TYPES} customer={chosen ? { id: chosen.id, name: chosen.company_name ?? chosen.full_name, phone: chosen.phone } : null} />
        </Card>
      )}
    </>
  );
}
