import "server-only";
import { getSettings } from "./settings";
import { workingMinutesSince, workingTimeOf } from "./jobs";
import { createAdminClient } from "./supabase/admin";

/**
 * Parts speed (2.4, 21 October 2026): how long every parts step really takes, per person and per
 * supplier, over the last 30 days, plus this week's list of steps over target. All durations are
 * working minutes (the workshop's hours, breaks out), shown as hours.
 */

export type SpeedRow = { who: string; n: number; avgMinutes: number };
export type LateRow = { what: string; who: string; minutes: number; target: number; href: string | null; when: string };
export type PartsSpeed = {
  pricing: SpeedRow[];
  approvalToLpo: SpeedRow[];
  approvedToOrdered: { people: SpeedRow[]; suppliers: SpeedRow[] };
  supplierLateness: { who: string; n: number; avgDays: number; lateShare: number }[];
  receivedToHandover: SpeedRow[];
  overTarget: LateRow[];
  targets: { pricingMinutes: number; orderMinutes: number };
};

function avgBy(rows: { who: string; minutes: number }[]): SpeedRow[] {
  const m = new Map<string, { n: number; total: number }>();
  for (const r of rows) {
    const cur = m.get(r.who) ?? { n: 0, total: 0 };
    cur.n += 1;
    cur.total += r.minutes;
    m.set(r.who, cur);
  }
  return Array.from(m.entries()).map(([who, v]) => ({ who, n: v.n, avgMinutes: v.total / v.n })).sort((a, b) => b.n - a.n);
}

export async function loadPartsSpeed(): Promise<PartsSpeed> {
  const admin = createAdminClient();
  const settings = await getSettings();
  const wt = workingTimeOf(settings);
  const from = new Date(Date.now() - 30 * 86400000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const pricingTarget = (Number(settings.parts_pricing_target_hours) || 4) * 60;
  const orderTarget = Number(settings.order_now_red_minutes) || 60;
  const between = (a: string, b: string) => Math.max(0, workingMinutesSince(a, wt, new Date(b)));

  const [{ data: priced }, { data: mains }, { data: orderedPos }, { data: lines }, { data: handed }, { data: staff }] = await Promise.all([
    admin.from("part_items").select("priced_at, priced_by, created_at, description, job_id, part_request:part_requests(created_at)").not("priced_at", "is", null).gte("priced_at", from).eq("is_active", true).limit(2000),
    admin.from("purchase_orders").select("created_at, created_by, job_id, number").eq("kind", "main").gte("created_at", from).limit(500),
    admin.from("purchase_orders").select("id, number, supplier_name, approved_at, ordered_at, ordered_by, job_id").in("kind", ["supplier", "stock"]).not("ordered_at", "is", null).not("approved_at", "is", null).gte("ordered_at", from).limit(800),
    admin.from("purchase_order_lines").select("expected_date, received_at, po:purchase_orders!inner(supplier_name)").not("received_at", "is", null).not("expected_date", "is", null).gte("received_at", from).limit(2000),
    admin.from("part_items").select("issue_confirmed_at, issue_confirmed_by, received_qty, updated_at, po_line_id, line:purchase_order_lines(received_at)").not("issue_confirmed_at", "is", null).gte("issue_confirmed_at", from).eq("is_active", true).limit(2000),
    admin.from("staff").select("id, display_name"),
  ]);
  const names = new Map(((staff ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "?") : "?");

  const pricingRows: { who: string; minutes: number; when: string; what: string; job: string | null }[] = [];
  for (const p of (priced ?? []) as unknown as { priced_at: string; priced_by: string | null; created_at: string; description: string; job_id: string | null; part_request: { created_at: string } | null }[]) {
    const start = p.part_request?.created_at ?? p.created_at;
    pricingRows.push({ who: nameOf(p.priced_by), minutes: between(start, p.priced_at), when: p.priced_at, what: `Price ${p.description}`, job: p.job_id });
  }

  // The customer's approval to the LPO going for approval, per job.
  const jobIds = Array.from(new Set((mains ?? []).map((m) => m.job_id as string | null).filter((x): x is string => !!x)));
  const { data: approvals } = jobIds.length ? await admin.from("quotations").select("job_id, responded_at").in("job_id", jobIds).eq("status", "approved").eq("is_active", true).not("responded_at", "is", null) : { data: [] };
  const approvedAt = new Map<string, string>();
  for (const q of (approvals ?? []) as { job_id: string; responded_at: string }[]) if (!approvedAt.has(q.job_id) || q.responded_at < approvedAt.get(q.job_id)!) approvedAt.set(q.job_id, q.responded_at);
  const lpoRows = ((mains ?? []) as { created_at: string; created_by: string | null; job_id: string | null }[])
    .filter((m) => m.job_id && approvedAt.has(m.job_id))
    .map((m) => ({ who: nameOf(m.created_by), minutes: between(approvedAt.get(m.job_id!)!, m.created_at) }));

  const orderRows = ((orderedPos ?? []) as { number: string; supplier_name: string; approved_at: string; ordered_at: string; ordered_by: string | null; job_id: string | null; id: string }[]).map((o) => ({ ...o, minutes: between(o.approved_at, o.ordered_at) }));

  const latenessBy = new Map<string, { n: number; totalDays: number; late: number }>();
  for (const l of (lines ?? []) as unknown as { expected_date: string; received_at: string; po: { supplier_name: string } }[]) {
    const days = Math.round((Date.parse(l.received_at) - Date.parse(`${l.expected_date}T17:00:00+04:00`)) / 86400000);
    const cur = latenessBy.get(l.po.supplier_name) ?? { n: 0, totalDays: 0, late: 0 };
    cur.n += 1;
    cur.totalDays += days;
    if (days > 0) cur.late += 1;
    latenessBy.set(l.po.supplier_name, cur);
  }

  const handRows = ((handed ?? []) as unknown as { issue_confirmed_at: string; issue_confirmed_by: string | null; line: { received_at: string | null } | null }[])
    .filter((h) => h.line?.received_at)
    .map((h) => ({ who: nameOf(h.issue_confirmed_by), minutes: between(h.line!.received_at!, h.issue_confirmed_at) }));

  const overTarget: LateRow[] = [
    ...pricingRows.filter((r) => r.when >= weekAgo && r.minutes > pricingTarget).map((r) => ({ what: r.what, who: r.who, minutes: r.minutes, target: pricingTarget, href: r.job ? `/parts/${r.job}` : null, when: r.when })),
    ...orderRows.filter((o) => o.ordered_at >= weekAgo && o.minutes > orderTarget).map((o) => ({ what: `Order ${o.number} (${o.supplier_name})`, who: nameOf(o.ordered_by), minutes: o.minutes, target: orderTarget, href: `/parts/orders/${o.id}`, when: o.ordered_at })),
  ].sort((a, b) => b.minutes - a.minutes).slice(0, 40);

  return {
    pricing: avgBy(pricingRows),
    approvalToLpo: avgBy(lpoRows),
    approvedToOrdered: { people: avgBy(orderRows.map((o) => ({ who: nameOf(o.ordered_by), minutes: o.minutes }))), suppliers: avgBy(orderRows.map((o) => ({ who: o.supplier_name, minutes: o.minutes }))) },
    supplierLateness: Array.from(latenessBy.entries()).map(([who, v]) => ({ who, n: v.n, avgDays: v.totalDays / v.n, lateShare: v.late / v.n })).sort((a, b) => b.avgDays - a.avgDays),
    receivedToHandover: avgBy(handRows),
    overTarget,
    targets: { pricingMinutes: pricingTarget, orderMinutes: orderTarget },
  };
}
