import Link from "next/link";
import { Card, SectionLabel } from "@/components/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobMoneyMany } from "@/lib/customer-money";
import { formatDate } from "@/lib/format";
import { formatPlate } from "@/lib/types";
import type { Settings } from "@/lib/settings";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * "Out with balance due" (13 November 2026, Section 5): every car that left the workshop still owing money, on the
 * owner's and accounts' dashboards, until it is paid. The figure is THE money of a job (jobMoneyMany), so it leaves the
 * list by itself the moment the payment is recorded.
 */
export async function OutWithBalance({ settings }: { settings: Settings }) {
  const admin = createAdminClient();
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 400 * 86400000).toISOString();
  // Only cars that left with a balance at the gate (the gate-out records it): the dashboards stay fast.
  const { data: go } = await admin.from("gate_outs").select("job_id").gt("balance_due_aed", 0).gte("created_at", since).limit(1000);
  const ids = Array.from(new Set(((go ?? []) as { job_id: string }[]).map((g) => g.job_id)));
  if (!ids.length) return null;
  const { data } = await admin.from("jobs").select("id, job_number, gated_out_at, customer_id, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant)").in("id", ids).eq("is_open", false).not("gated_out_at", "is", null).order("gated_out_at", { ascending: true });
  const jobs = (data ?? []) as unknown as { id: string; job_number: string; gated_out_at: string; customer_id: string | null; vehicle: Parameters<typeof formatPlate>[0] | null }[];
  if (!jobs.length) return null;
  const money = await jobMoneyMany(jobs.map((j) => j.id), settings);
  const owing = jobs.map((j) => ({ j, m: money.get(j.id) })).filter((x) => (x.m?.balance ?? 0) > 0.004);
  if (!owing.length) return null;
  const { data: cust } = await admin.from("customers").select("id, full_name").in("id", Array.from(new Set(owing.map((x) => x.j.customer_id).filter((x): x is string => !!x))));
  const nameOf = new Map(((cust ?? []) as { id: string; full_name: string }[]).map((c) => [c.id, c.full_name]));
  const total = owing.reduce((a, x) => a + (x.m?.balance ?? 0), 0);
  return (
    <Card className="flex flex-col gap-2 !border-red-bar" data-out-with-balance>
      <SectionLabel right={<span className="whitespace-nowrap text-red">{aed(total)}</span>}>Out with balance due · {owing.length}</SectionLabel>
      <ul className="flex flex-col divide-y divide-line">
        {owing.map(({ j, m }) => (
          <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm" data-out-owing={j.id}>
            <Link href={`/jobs/${j.id}/invoice`} className="min-w-0 flex-1 font-semibold underline-offset-4 hover:underline">{j.job_number} · {j.vehicle ? formatPlate(j.vehicle) : ""}{j.customer_id && nameOf.get(j.customer_id) ? ` · ${nameOf.get(j.customer_id)}` : ""}</Link>
            <span className="text-xs text-muted">left {formatDate(j.gated_out_at)}</span>
            <span className="whitespace-nowrap font-extrabold text-red">{aed(m?.balance ?? 0)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
