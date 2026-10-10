import Link from "next/link";
import { Badge, Card, Empty, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { COMEBACK_CAUSE_LABELS, isOurFault, type ComebackCause } from "@/lib/comebacks";
import { formatDate } from "@/lib/format";
import { dubaiDate } from "@/lib/jobs";
import { jobProfits } from "@/lib/profit";
import type { RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = { id: string; job_number: string; gated_in_at: string; status: string; comeback_of: string; comeback_cause: ComebackCause | null; comeback_free: boolean; comeback_claim_status: string; comeback_claim_amount: number | string | null; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null };

/** Comebacks by month: the car, the original job, the cause, the technicians, the cost to us, the claim. Owner and managers. */
export default async function ComebacksPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requirePermission("manageWork");
  const role = staff.role_id as RoleId;
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : dubaiDate().slice(0, 7);
  const from = new Date(`${month}-01T00:00:00+04:00`).toISOString();
  const next = new Date(`${month}-01T00:00:00+04:00`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const admin = createAdminClient();
  const { data } = await admin.from("jobs").select("id, job_number, gated_in_at, status, comeback_of, comeback_cause, comeback_free, comeback_claim_status, comeback_claim_amount, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))").not("comeback_of", "is", null).gte("gated_in_at", from).lt("gated_in_at", next.toISOString()).order("gated_in_at", { ascending: false });
  const rows = (data ?? []) as unknown as Row[];
  const originalIds = Array.from(new Set(rows.map((r) => r.comeback_of)));
  const [{ data: originals }, { data: techRows }, profits] = await Promise.all([
    originalIds.length ? admin.from("jobs").select("id, job_number").in("id", originalIds) : Promise.resolve({ data: [] as { id: string; job_number: string }[] }),
    originalIds.length ? admin.from("job_technicians").select("job_id, staff:staff!job_technicians_staff_id_fkey(display_name)").in("job_id", originalIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    role === "owner" && rows.length ? jobProfits(await getSettings(), { jobIds: rows.map((r) => r.id) }) : Promise.resolve([]),
  ]);
  const numberOf = new Map((originals ?? []).map((o) => [o.id, o.job_number]));
  const techsOf = new Map<string, string[]>();
  for (const t of (techRows ?? []) as unknown as { job_id: string; staff: { display_name: string } | null }[]) techsOf.set(t.job_id, [...(techsOf.get(t.job_id) ?? []), t.staff?.display_name ?? "Technician"]);
  const lossOf = (id: string) => {
    const p = profits.find((x) => x.invoice.job_id === id);
    return p ? Math.max(0, -p.profit) : null;
  };
  const totalLoss = rows.reduce((a, r) => a + (isOurFault(r.comeback_cause) ? (lossOf(r.id) ?? 0) : 0), 0);
  const claimed = rows.reduce((a, r) => a + (r.comeback_claim_status === "paid" ? Number(r.comeback_claim_amount) || 0 : 0), 0);
  const shift = (n: number) => {
    const d = new Date(`${month}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 7);
  };
  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(`${month}-01T12:00:00+04:00`));
  const ours = rows.filter((r) => isOurFault(r.comeback_cause)).length;
  return (
    <>
      <PageHeader title="Comebacks" subtitle={`${label} · ${rows.length} car${rows.length === 1 ? "" : "s"} back · ${ours} our fault${role === "owner" ? ` · cost AED ${Math.round(totalLoss).toLocaleString("en-GB")}${claimed ? `, AED ${Math.round(claimed).toLocaleString("en-GB")} claimed back` : ""}` : ""}`} actions={<span className="flex gap-2"><Link href={`/comebacks?month=${shift(-1)}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold">Previous month</Link><Link href={`/comebacks?month=${shift(1)}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold">Next month</Link></span>} />
      {rows.length === 0 ? <Empty title="No comebacks this month" /> : null}
      {rows.length ? (
        <Card className="p-0 overflow-hidden">
          <SectionLabel>Cars</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {rows.map((r) => {
              const loss = lossOf(r.id);
              const paid = r.comeback_cause === "unrelated" || r.comeback_cause === "customer_caused";
              return (
                <li key={r.id} className="px-5 py-2.5 flex flex-wrap items-center gap-3">
                  <Link href={`/jobs/${r.id}`} className="font-extrabold underline underline-offset-4">{r.vehicle ? formatPlate(r.vehicle) : r.job_number}</Link>
                  <span className="text-muted">{[r.vehicle?.make?.name, r.vehicle?.model?.name].filter(Boolean).join(" ")} · {r.job_number} · {formatDate(r.gated_in_at)}</span>
                  <span>of <Link href={`/jobs/${r.comeback_of}`} className="font-semibold underline underline-offset-4">{numberOf.get(r.comeback_of) ?? "previous job"}</Link></span>
                  <Badge tone={paid ? "outline" : r.comeback_cause ? "red" : "amber"}>{r.comeback_cause ? COMEBACK_CAUSE_LABELS[r.comeback_cause] : "Cause not set"}</Badge>
                  <Badge tone={paid ? "neutral" : "ink"}>{paid ? "Return visit (paid)" : r.comeback_free ? "Free of charge" : "Comeback"}</Badge>
                  {techsOf.get(r.comeback_of)?.length ? <span className="text-muted">{techsOf.get(r.comeback_of)!.join(", ")}</span> : null}
                  {r.comeback_cause === "faulty_part" ? <Badge tone={r.comeback_claim_status === "paid" ? "green" : "amber"}>Claim: {r.comeback_claim_status === "none" ? "not made" : r.comeback_claim_status.replace("_", " ")}{r.comeback_claim_amount ? ` AED ${Number(r.comeback_claim_amount).toLocaleString("en-GB")}` : ""}</Badge> : null}
                  {role === "owner" && isOurFault(r.comeback_cause) ? <span className="ml-auto font-extrabold text-red">{loss === null ? "not invoiced yet" : `− AED ${Math.round(loss).toLocaleString("en-GB")}`}</span> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      <p className="text-xs text-muted">The cost of a comeback is the loss on its invoice: the real parts and clocked labour with nothing charged. A paid supplier claim reduces it.</p>
    </>
  );
}
