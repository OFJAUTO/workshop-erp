import "server-only";
import { createChargeInvoice } from "./invoice-flow";
import { dropParts } from "./drop-parts";
import { loadInspection } from "./inspection-data";
import { loadJobCard } from "./job-data";
import { notifyManagers } from "./notifications";
import { logQuoteEvent } from "./quote-data";
import { loadReportData } from "./report-data";
import { ROAD_TEST_SELECT } from "./road-test";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

/**
 * "Customer declined all work" (29 October 2026, batch 2 section 2): the ONE place that closes a car the customer
 * approved nothing on. The quotations stay (marked declined, every line kept in the history); every finding and
 * quoted line is saved against the car as DECLINED WORK with its status; the inspection fee agreed at gate-in becomes
 * an invoice with one line "INSPECTION CHARGES" whose cost is the real clocked time (booked as labour by profit.ts, never
 * typed by hand) and whose note lists the declined work for the customer; the car goes to Ready to collect.
 */
export const SEVERITY = ["Replace now", "Replace", "Advisory"] as const;
export type Severity = (typeof SEVERITY)[number];
export type DeclinedItem = { title: string; severity: Severity };
type Actor = { id: string; display_name: string };

/** The customer's invoice note: the declined work by name and status - no prices, no part numbers. */
export function declinedNote(items: DeclinedItem[]): string | null {
  if (!items.length) return null;
  return ["Recommended work declined by the customer:", ...items.map((i) => `• ${i.title} – ${i.severity}`)].join("\n");
}

/** What the customer declined on this job: the report's findings (worst first), then quoted work no finding covers. */
export async function declinedItemsOf(jobId: string, settings: Settings): Promise<DeclinedItem[]> {
  const admin = createAdminClient();
  const items: DeclinedItem[] = [];
  const bundle = await loadInspection(jobId).catch(() => null);
  if (bundle?.inspection && ["submitted", "approved"].includes(bundle.inspection.status)) {
    const [card, { data: rt }] = await Promise.all([loadJobCard(admin, jobId, { customerPage: true }), admin.from("road_tests").select(ROAD_TEST_SELECT).eq("job_id", jobId).maybeSingle()]);
    if (card) {
      const data = await loadReportData(card, bundle, rt as never, settings);
      for (const f of data.layout.attention) items.push({ title: f.title, severity: SEVERITY[Math.max(0, Math.min(2, f.rank))] });
    }
  }
  const { data: lines } = await admin
    .from("quotation_lines")
    .select("title, line_type, urgency, visible_to_customer, quotation:quotations!inner(job_id, kind, is_active, status)")
    .eq("quotation.job_id", jobId)
    .eq("quotation.kind", "quotation")
    .eq("quotation.is_active", true)
    .eq("is_active", true);
  const seen = new Set(items.map((i) => i.title.trim().toLowerCase()));
  for (const l of (lines ?? []) as unknown as { title: string; line_type: string; urgency: string | null; visible_to_customer: boolean }[]) {
    const t = (l.title ?? "").trim();
    if (!t || !l.visible_to_customer || ["fee", "recovery"].includes(l.line_type) || seen.has(t.toLowerCase()) || /inspection charge/i.test(t)) continue;
    seen.add(t.toLowerCase());
    items.push({ title: t, severity: l.urgency === "urgent" ? "Replace" : "Advisory" });
  }
  return items;
}

/** Saves the declined work against the car (once per title per job), each with the advisor's follow-up date. */
export async function saveDeclinedWork(jobId: string, items: DeclinedItem[], actor: Actor | null, settings: Settings): Promise<number> {
  if (!items.length) return 0;
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("vehicle_id, customer_id").eq("id", jobId).maybeSingle();
  if (!job) return 0;
  const { data: already } = await admin.from("declined_work").select("id, title, severity").eq("job_id", jobId).eq("is_active", true);
  const known = new Map((already ?? []).map((r) => [String(r.title).trim().toLowerCase(), r]));
  const days = Math.max(1, Number(settings.declined_followup_days) || 14);
  const now = new Date();
  const due = new Date(now.getTime() + days * 86400000).toISOString();
  let added = 0;
  for (const i of items) {
    const old = known.get(i.title.trim().toLowerCase());
    if (old) {
      // Saved earlier by the quotation's own decline (no status yet): give it its status and the follow-up.
      if (!old.severity) await admin.from("declined_work").update({ severity: i.severity, follow_up_due_at: due, updated_by: actor?.id ?? null }).eq("id", old.id);
      continue;
    }
    await admin.from("declined_work").insert({ vehicle_id: job.vehicle_id, customer_id: job.customer_id, job_id: jobId, title: i.title, severity: i.severity, declined_at: now.toISOString(), follow_up_due_at: due, created_by: actor?.id ?? null, updated_by: actor?.id ?? null });
    added++;
  }
  return added;
}

export type DeclineAllResult = { ok: true; invoiceNumber: string | null; total: number | null; saved: number } | { error: string };

export async function declineAllWork(jobId: string, actor: Actor, settings: Settings, opts: { amount: number; reason: string | null; isOwner: boolean }): Promise<DeclineAllResult> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, status, is_open, department, gated_in_by, inspection_fee_aed, declined_out_at, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is closed." };
  if (job.declined_out_at) return { error: "Already marked: the customer declined all work on this car." };
  const { data: approved } = await admin.from("quotations").select("number").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).eq("status", "approved").limit(1);
  if ((approved ?? []).length) return { error: `${approved![0].number} is approved: part of the work goes ahead, so this is not a full decline. Change the quotation instead.` };
  const fee = Number(job.inspection_fee_aed) || 0;
  const amount = Math.round(Math.max(0, opts.amount) * 100) / 100;
  if (amount !== fee && !opts.isOwner && (opts.reason ?? "").trim().length < 5) return { error: `The fee agreed at gate-in is AED ${fee.toLocaleString("en-GB")}. To charge a different amount, give the reason (the owner may change it without one).` };
  const now = new Date().toISOString();
  const plate = job.vehicle ? formatPlate(job.vehicle as unknown as Parameters<typeof formatPlate>[0]) : job.job_number;

  // The declined work first (it reads the quotations before they are marked).
  const items = await declinedItemsOf(jobId, settings);
  const saved = await saveDeclinedWork(jobId, items, actor, settings);

  // The quotations stay, every line kept: marked declined by the customer.
  const { data: open } = await admin.from("quotations").select("id, number, version, status").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).in("status", ["draft", "pending_owner", "sent", "opened", "expired", "urgent_requested"]);
  for (const q of open ?? []) {
    await admin.from("quotations").update({ status: "declined", responded_at: now, updated_by: actor.id }).eq("id", q.id);
    await logQuoteEvent(q.id as string, jobId, actor.id, "quote_declined", `${q.number} v${q.version}: the customer declined all work (recorded by ${actor.display_name}); the lines stay in the history`);
  }

  // The inspection fee agreed at gate-in, as its own invoice (cost = the clocked time, counted as labour by profit.ts).
  let invoiceId: string | null = null;
  let invoiceNumber: string | null = null;
  let total: number | null = null;
  if (amount > 0) {
    const inv = await createChargeInvoice(jobId, actor, settings, { description: "INSPECTION CHARGES", amount });
    if ("error" in inv) return { error: inv.error };
    invoiceId = inv.id;
    invoiceNumber = inv.number;
    total = inv.total;
    await admin.from("invoices").update({ notes: declinedNote(items), issue_reason: "Inspection charges: the customer declined all work", updated_by: actor.id }).eq("id", inv.id);
  }
  if (amount !== fee) {
    await admin.from("job_events").insert({ job_id: jobId, event_type: "inspection_fee_changed", note: `Inspection fee charged AED ${amount.toLocaleString("en-GB")} instead of the AED ${fee.toLocaleString("en-GB")} agreed at gate-in, by ${actor.display_name}${opts.reason ? `: ${opts.reason}` : ""}`, created_by: actor.id });
  }

  // Parts: open requests cancelled, unordered parts off the list, ordered ones put to Parts.
  const { data: openReqs } = await admin.from("part_requests").select("id").eq("job_id", jobId).eq("is_active", true).eq("status", "open");
  for (const r of openReqs ?? []) await admin.from("part_requests").update({ status: "rejected", closed_reason: "Customer declined all work", removed_at: now, removed_by: actor.id, removed_reason: "Customer declined all work", updated_by: actor.id }).eq("id", r.id);
  const { data: parts } = await admin.from("part_items").select("id").eq("job_id", jobId).eq("is_active", true);
  await dropParts(jobId, (parts ?? []).map((p) => p.id as string), actor, "declined");

  // Ready to collect: the normal invoice and payment-link flow follows.
  await admin.from("jobs").update({ status: "ready", stage: "ready", stage_entered_at: now, declined_out_at: now, declined_charge_invoice_id: invoiceId, inspection_fee_due: false, updated_by: actor.id }).eq("id", jobId);
  const chargeText = invoiceNumber ? ` ${invoiceNumber} for the inspection (AED ${total!.toLocaleString("en-GB", { minimumFractionDigits: 2 })}) is to be paid before the car leaves.` : " No inspection fee was agreed: the car leaves free.";
  await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: job.status, to_status: "ready", note: `The customer declined all work (${actor.display_name}): ${items.length} item${items.length === 1 ? "" : "s"} saved as declined work.${chargeText}`, created_by: actor.id });
  const n = { type: "job_declined_out", title: `${plate} · ${job.job_number}: customer declined all work, put the car back together for collection`, body: `Open parts requests are cancelled.${chargeText}`, jobId, href: `/jobs/${jobId}` };
  await notifyManagers((job.department as string | null) ?? null, n);
  return { ok: true, invoiceNumber, total, saved };
}

/**
 * Waiting on you (advisors and the owner): "Call <customer> about the declined work on <plate> (…)" once the declined
 * work is due its follow-up (Settings, default 14 days). An advisor sees the cars they are in charge of (and cars with
 * no advisor); the owner sees all. "Called ✓" on the row closes it (markDeclinedCalled).
 */
export async function declinedFollowUps(staff: { id: string; role_id: string }): Promise<{ jobId: string; plate: string; car: string | null; what: string; ids: string[]; since: string; href: string }[]> {
  if (staff.role_id !== "owner" && staff.role_id !== "service_advisor") return [];
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("declined_work")
    .select("id, job_id, title, severity, follow_up_due_at, customer_id, vehicle_id")
    .eq("is_active", true)
    .is("followed_up_at", null)
    .is("done_at", null)
    .not("follow_up_due_at", "is", null)
    .lte("follow_up_due_at", new Date().toISOString())
    .order("follow_up_due_at")
    .limit(200);
  const byJob = new Map<string, NonNullable<typeof rows>>();
  for (const r of rows ?? []) {
    if (!r.job_id) continue;
    const list = byJob.get(r.job_id as string) ?? [];
    list.push(r);
    byJob.set(r.job_id as string, list);
  }
  if (!byJob.size) return [];
  const jobIds = [...byJob.keys()];
  const { data: jobs } = await admin.from("jobs").select("id, advisor_id, customer_id, vehicle:vehicles(id, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))").in("id", jobIds);
  const customerIds = [...new Set((jobs ?? []).map((j) => j.customer_id as string).filter(Boolean))];
  const { data: customers } = customerIds.length ? await admin.from("customers").select("id, full_name, company_name").in("id", customerIds) : { data: [] as { id: string; full_name: string | null; company_name: string | null }[] };
  const nameOf = new Map((customers ?? []).map((c) => [c.id as string, (c.company_name as string | null) || (c.full_name as string | null) || "the customer"]));
  const out = [];
  for (const j of jobs ?? []) {
    if (staff.role_id === "service_advisor" && j.advisor_id && j.advisor_id !== staff.id) continue;
    const list = byJob.get(j.id as string) ?? [];
    const v = j.vehicle as unknown as (Parameters<typeof formatPlate>[0] & { id: string; make: { name: string } | null; model: { name: string } | null }) | null;
    const plate = v ? formatPlate(v) : "the car";
    const titles = list.map((r) => String(r.title));
    const shown = titles.slice(0, 3).join(", ") + (titles.length > 3 ? ` +${titles.length - 3} more` : "");
    out.push({
      jobId: j.id as string,
      plate,
      car: v ? [v.make?.name, v.model?.name].filter(Boolean).join(" ") || null : null,
      what: `Call ${nameOf.get(j.customer_id as string) ?? "the customer"} about the declined work on ${plate.toUpperCase()} (${shown})`,
      ids: list.map((r) => r.id as string),
      since: String(list[0].follow_up_due_at),
      href: v?.id ? `/vehicles/${v.id}` : `/jobs/${j.id}`,
    });
  }
  return out;
}
