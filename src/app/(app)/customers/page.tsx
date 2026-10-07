import Link from "next/link";
import { Avatar, Badge, Button, Card, Empty, Input, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { CustomerRow } from "@/lib/types";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const staff = await requirePermission("viewCustomers");
  const { q = "", show } = await searchParams;
  const term = q.trim();
  const canEdit = can(staff.role_id as RoleId, "editCustomers");

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id, customer_number, customer_type, full_name, company_name, phone, phone2, email, area, trn, is_vip, vip_note, notes, is_active, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(120);
  if (show !== "all") query = query.eq("is_active", true);
  if (term) {
    const like = `%${term.replace(/[%_]/g, "")}%`;
    const digits = term.replace(/[^\d]/g, "");
    const parts = [`full_name.ilike.${like}`, `company_name.ilike.${like}`, `customer_number.ilike.${like}`, `email.ilike.${like}`];
    if (digits.length >= 3) parts.push(`phone.ilike.%${digits}%`, `phone2.ilike.%${digits}%`);
    query = query.or(parts.join(","));
  }
  const { data } = await query;
  const rows = (data ?? []) as CustomerRow[];

  const ids = rows.map((r) => r.id);
  const { data: carRows } = ids.length
    ? await supabase.from("vehicles").select("customer_id").in("customer_id", ids).eq("is_active", true)
    : { data: [] as { customer_id: string }[] };
  const carCount = new Map<string, number>();
  for (const c of carRows ?? []) carCount.set(c.customer_id, (carCount.get(c.customer_id) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Customers"
        actions={canEdit ? <LinkButton href="/customers/new">Add customer</LinkButton> : undefined}
      />

      <form className="flex flex-wrap gap-2" action="/customers">
        <Input name="q" defaultValue={q} placeholder="Search by name, company, phone or customer number" className="max-w-md" />
        {show === "all" ? <input type="hidden" name="show" value="all" /> : null}
        <Button type="submit" tone="secondary">
          Search
        </Button>
        <LinkButton href={show === "all" ? "/customers" : "/customers?show=all"} tone="ghost">
          {show === "all" ? "Hide archived" : "Show archived"}
        </LinkButton>
      </form>

      {rows.length === 0 ? (
        <Empty title={term ? "No customers match" : "No customers yet"}>
          {canEdit ? "Add the first customer with the button above." : null}
        </Empty>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {rows.map((c) => {
            const cars = carCount.get(c.id) ?? 0;
            return (
              <Link key={c.id} href={`/customers/${c.id}`} className="block">
                <Card className="flex items-start gap-4 hover:border-ink h-full">
                  <Avatar name={c.company_name ?? c.full_name} size={64} />
                  <span className="flex flex-col gap-1.5 min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-base break-words">{c.company_name ?? c.full_name}</span>
                      {c.is_vip ? <Badge tone="ink">VIP</Badge> : null}
                      {!c.is_active ? <Badge tone="red">Archived</Badge> : null}
                    </span>
                    {c.company_name ? <span className="text-sm text-muted break-words">{c.full_name}</span> : null}
                    <span className="text-sm font-medium">{c.phone}</span>
                    <span className="text-xs text-muted">
                      {c.customer_number}
                      {c.area ? ` · ${c.area}` : ""}
                      {` · ${cars} car${cars === 1 ? "" : "s"}`}
                    </span>
                  </span>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
