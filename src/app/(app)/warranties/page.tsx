import Link from "next/link";
import { staffFinalCheckWords } from "@/lib/warranty";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Input, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { warrantyCardOf, type WarrantyCard } from "@/lib/warranty-data";

export const dynamic = "force-dynamic";

/**
 * Section 12: the warranty list (owner and advisors). Search by VIN, plate or customer: what is covered, the rolls
 * and batches used, the status, and whether the 10-day check was done. Without a search: the latest cars handed over.
 */
export default async function WarrantiesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const staff = await requireStaff();
  if (!(staff.role_id === "owner" || staff.role_id === "service_advisor")) redirect("/home");
  const { q: rawQ } = await searchParams;
  const q = (rawQ ?? "").trim().slice(0, 60);
  const settings = await getSettings();
  const admin = createAdminClient();

  let jobIds: string[] = [];
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const digits = q.replace(/[^\d]/g, "");
    const [byPlate, byVin, byName, byCompany, byPhone] = await Promise.all([
      admin.from("vehicles").select("id").ilike("plate_number", like).limit(50),
      admin.from("vehicles").select("id").ilike("vin", like).limit(50),
      admin.from("customers").select("id").ilike("full_name", like).limit(50),
      admin.from("customers").select("id").ilike("company_name", like).limit(50),
      digits.length >= 5 ? admin.from("customers").select("id").ilike("phone", `%${digits}%`).limit(50) : Promise.resolve({ data: [] as { id: string }[] }),
    ]);
    const vehicleIds = [...(byPlate.data ?? []), ...(byVin.data ?? [])].map((r) => r.id as string);
    const customerIds = [...(byName.data ?? []), ...(byCompany.data ?? []), ...(byPhone.data ?? [])].map((r) => r.id as string);
    const [{ data: jv }, { data: jc }] = await Promise.all([
      vehicleIds.length ? admin.from("jobs").select("id, created_at").in("vehicle_id", vehicleIds).in("department", ["bodyshop", "both"]).order("created_at", { ascending: false }).limit(40) : Promise.resolve({ data: [] as { id: string; created_at: string }[] }),
      customerIds.length ? admin.from("jobs").select("id, created_at").in("customer_id", customerIds).in("department", ["bodyshop", "both"]).order("created_at", { ascending: false }).limit(40) : Promise.resolve({ data: [] as { id: string; created_at: string }[] }),
    ]);
    jobIds = Array.from(new Set([...(jv ?? []), ...(jc ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((r) => r.id as string))).slice(0, 40);
  } else {
    const { data } = await admin.from("jobs").select("id").in("department", ["bodyshop", "both"]).not("gated_out_at", "is", null).order("gated_out_at", { ascending: false }).limit(40);
    jobIds = (data ?? []).map((r) => r.id as string);
  }

  const cards: WarrantyCard[] = [];
  for (let i = 0; i < jobIds.length; i += 8) {
    const batch = await Promise.all(jobIds.slice(i, i + 8).map((id) => warrantyCardOf(id, settings)));
    for (const c of batch) if (c?.rows.length) cards.push(c);
  }
  const { data: custRows } = cards.length ? await admin.from("jobs").select("id, customer:customers(full_name, company_name)").in("id", cards.map((c) => c.jobId)) : { data: [] as { id: string; customer: unknown }[] };
  const customerOf = new Map((custRows ?? []).map((r) => [r.id as string, r.customer as { full_name: string | null; company_name: string | null } | null]));
  const tone = (k: string) => (k === "active" ? "green" : k === "not_activated" ? "red" : k === "pending" ? "amber" : "neutral") as "green" | "red" | "amber" | "neutral";

  return (
    <>
      <PageHeader title="Warranties" subtitle="What each car is covered for, the rolls and batches used, the status and the 10-day check. Search by VIN, plate or customer." />
      <form className="flex flex-wrap items-center gap-2" data-warranty-search>
        <Input name="q" defaultValue={q} placeholder="VIN, plate or customer" aria-label="Search" className="min-w-0 flex-1" style={{ maxWidth: "28rem" }} />
        <Button type="submit" size="md">Search</Button>
        {q ? <Link href="/warranties" className="text-sm font-semibold underline underline-offset-4">Clear</Link> : null}
      </form>
      {cards.length === 0 ? <Card><p className="text-sm text-muted">{q ? "No warranty found for that search." : "No car with a product warranty has been handed over yet."}</p></Card> : null}
      <div className="flex flex-col gap-3" data-warranty-list={cards.length}>
        {cards.map((c) => {
          const cust = customerOf.get(c.jobId);
          const rolls = c.rows.map((r) => r.rollBatch).filter((x): x is string => !!x);
          const check = !c.check ? "No 10-day check on this job" : c.check.done_at ? `10-day check done ${formatDate(c.check.done_at)}` : c.check.activated_at ? `Activated by hand ${formatDate(c.check.activated_at)}` : c.handoverDay ? `10-day check not done (due ${formatDate(c.check.due_date)})` : "10-day check after the handover";
          return (
            <Card key={c.jobId} className="flex flex-col gap-2" data-warranty-item={c.jobId}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold">{c.plate ?? "No plate"} · {c.car}</span>
                <span className="text-sm text-muted">{cust?.company_name || cust?.full_name || ""}</span>
                <span data-warranty-item-status={c.status.kind}><Badge tone={tone(c.status.kind)}>{c.status.title}</Badge></span>
                {staffFinalCheckWords(c.status) ? <span className={`text-xs font-bold ${c.status.checkDate ? "text-green" : "text-red"}`} data-final-check-staff>{staffFinalCheckWords(c.status)}</span> : null}
                <span className="ml-auto flex flex-wrap gap-3 text-sm">
                  <Link href={`/jobs/${c.jobId}`} className="font-semibold underline underline-offset-4">{c.jobNumber}</Link>
                  {c.token ? <a href={`/warranty/${c.token}`} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4">Warranty page</a> : null}
                </span>
              </div>
              <ul className="flex flex-col gap-0.5 text-sm">
                {c.rows.map((r) => (
                  <li key={`${r.product}:${r.itemKey}`}><span className="font-semibold">{r.name}</span> · {r.coverage}{r.darkness ? ` · ${r.darkness}` : ""} · {r.period}{r.validUntil ? ` to ${formatDate(r.validUntil)}` : ""}</li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                {c.handoverDay ? `Handed over ${formatDate(c.handoverDay)}` : "Not handed over yet"} · Rolls and batches: {rolls.length ? rolls.join(", ") : "not written yet"} · <span className={c.check && !c.check.done_at && !c.check.activated_at && c.handoverDay ? "font-semibold text-red" : ""} data-warranty-check>{check}</span>
              </p>
            </Card>
          );
        })}
      </div>
    </>
  );
}
