import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./supabase/admin";
import { loadMedia, signMedia } from "./media";
import { getCurrentStaff } from "./auth";
import { seesCustomers } from "./customer-data";
import { redactCustomer } from "./customer-view";
import type { ApprovalRequestRow, GateInMediaRow, GateInRow, GateOutRow, JobEventRow, JobRequestRow, JobRow } from "./types";

export type JobCard = {
  job: JobRow;
  vehicle: {
    id: string;
    kind: "car" | "loose";
    photo_path: string | null;
    has_plate: boolean;
    plate_country: string;
    plate_emirate: string | null;
    plate_code: string | null;
    plate_number: string | null;
    vin: string | null;
    fuel_type: string | null;
    variant: string | null;
    model_year: number | null;
    colour: string | null;
    make: { name: string } | null;
    model: { name: string } | null;
  };
  /** Null when the viewer's role may not see customer details. */
  customer: { id: string; customer_number: string; full_name: string; company_name: string | null; phone: string; is_vip: boolean; vip_note: string | null } | null;
  vip: { is_vip: boolean; vip_note: string | null } | null;
  /** Name and VIP mark: only for a viewer who may see customers (owner, advisors, accounts) or a customer page; null otherwise. */
  customerPublic: { full_name: string; company_name: string | null; is_vip: boolean; vip_note: string | null } | null;
  gateIn: GateInRow | null;
  requests: JobRequestRow[];
  media: GateInMediaRow[];
  mediaUrls: Map<string, string>;
  vehiclePhotoUrl: string | null;
  events: (JobEventRow & { by_name: string | null; from_name: string | null; to_name: string | null })[];
  approvals: ApprovalRequestRow[];
  gateOut: GateOutRow | null;
  assignee: { id: string; display_name: string } | null;
  gatedInBy: string | null;
  gatedOutBy: string | null;
};

const JOB_SELECT =
  "advisor_id, service_sticker, job_kind, recheck_of, inspection_fee_choice, no_fee_reason, no_fee_note, inspection_type, assessment_note, owner_report_at, declined_out_at, declined_charge_invoice_id, invoice_sent_at, budget_hours, budget_reason, budget_by, budget_at, id, job_number, vehicle_id, customer_id, stage, status, priority, promised_at, assigned_to, assigned_at, gated_in_at, gated_in_by, gated_out_at, gated_out_by, first_approval_at, stage_entered_at, is_open, department, assignment_note, assignment_note_by, assignment_note_at, assignment_reminded_at, assignment_overdue_notified_at, estimate_id, inspection_fee_due, inspection_fee_aed, inspection_fee_request_aed, inspection_fee_request_by, parts_state, work_started_at, work_completed_at, qc_round, rework_count, mileage_out, ready_to_invoice_at, ready_to_invoice_by, ready_token, ready_sent_at, deposit_requested_at, deposit_requested_by, followup_due_at, followup_done_at, plan_parts_done_at, plan_parts_by, plan_parts_ready_date, plan_start_date, plan_released_at, plan_released_by, plan_release_note, plan_bodyshop_released_at, plan_bodyshop_released_by, plan_bodyshop_start_date, bodyshop_started_at, plan_date_confirmed_at, plan_date_confirmed_by, plan_reminded_at, work_done_at, work_sendbacks, wash_sent_at, wash_sent_by, comeback_of, comeback_cause, comeback_cause_by, comeback_cause_at, comeback_confirmed_by, comeback_confirmed_at, comeback_free, comeback_claim_status, comeback_claim_amount, comeback_claim_po, comeback_claim_supplier, summary, summary_verdict, summary_at, summary_comment, summary_comment_by, created_at, updated_at";

/**
 * Everything a job card screen needs. `client` decides what the viewer may see (their own session, or the master key
 * for public pages). Customer details (29 October 2026, batch 2 section 1): a customer page (nobody signed in) and the
 * owner, advisors and accounts get them; any other signed-in role gets the car only - no customer name, approver, pickup
 * address or loose-item names, and history notes with every customer word and phone number replaced. Those columns are
 * not readable by the login role at all; the server reads them here.
 */
export async function loadJobCard(client: SupabaseClient, jobId: string, opts: { customerPage?: boolean } = {}): Promise<JobCard | null> {
  const { data: job } = await client.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  if (!job) return null;
  const viewer = opts.customerPage ? null : await getCurrentStaff();
  const full = !viewer || seesCustomers(viewer.role_id);

  const [{ data: vehicle }, { data: customer }, { data: vip }, { data: gateIn }, { data: events }, { data: approvals }, { data: gateOut }, { data: requests }, { data: customerPublic }] =
    await Promise.all([
      client
        .from("vehicles")
        .select("id, kind, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, fuel_type, variant, model_year, colour, make:vehicle_makes(name), model:vehicle_models(name)")
        .eq("id", job.vehicle_id)
        .maybeSingle(),
      client
        .from("customers")
        .select("id, customer_number, full_name, company_name, phone, is_vip, vip_note")
        .eq("id", job.customer_id)
        .maybeSingle(),
      createAdminClient().from("customers").select("is_vip, vip_note").eq("is_active", true).eq("id", job.customer_id).maybeSingle(),
      client
        .from("gate_ins")
        .select("id, job_id, arrived_by, condition, fuel_level, battery_percent, cleanliness, dash_cam, major_damage, mileage, mileage_unit, mileage_miles, keys_count, keys_keychain, customer_requests, notes, old_parts_return, damage_note, wheels_required, location_type, is_complete, completed_at, created_at, updated_at")
        .eq("job_id", jobId)
        .maybeSingle(),
      client
        .from("job_events")
        .select("id, job_id, event_type, from_status, to_status, from_stage, to_stage, from_staff, to_staff, note, created_at, created_by")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
      client
        .from("approval_requests")
        .select("id, job_id, kind, token, sent_to_name, sent_to_phone, sent_at, sent_method, sent_by, opened_at, approved_at, approver_name, terms_text, terms_text_ar, declaration_text, declaration_text_ar, reminded_at, status, created_at")
        .eq("job_id", jobId)
        .order("sent_at", { ascending: false }),
      client
        .from("gate_outs")
        .select("id, job_id, keys_returned, keychain_returned, keys_match, keys_override_by, keys_override_reason, dash_cam_reconnected, old_parts_handed, balance_due_aed, release_approved_by, release_reason, notes, created_at")
        .eq("job_id", jobId)
        .maybeSingle(),
      client.from("job_requests").select("id, job_id, position, text, is_active").eq("job_id", jobId).eq("is_active", true).order("position"),
      createAdminClient().from("customers").select("full_name, company_name, is_vip, vip_note").eq("is_active", true).eq("id", job.customer_id).maybeSingle(),
    ]);
  if (!vehicle) return null;
  const adminPriv = createAdminClient();
  const [{ data: priv }, { data: privJob }] = await Promise.all([
    adminPriv.from("gate_ins").select("location_name, location_address, location_lat, location_lng").eq("job_id", jobId).maybeSingle(),
    adminPriv.from("jobs").select("brought_by").eq("id", jobId).maybeSingle(),
  ]);
  if (full) {
    if (gateIn) Object.assign(gateIn, priv ?? {});
    Object.assign(job, { brought_by: privJob?.brought_by ?? null });
  } else {
    if (gateIn) Object.assign(gateIn, { location_name: null, location_address: null, location_lat: null, location_lng: null });
    Object.assign(job, { brought_by: null });
  }
  // Every customer word this job knows, so a workshop screen's history never shows one.
  let secrets: (string | null | undefined)[] = [];
  if (!full) {
    // Read with the master key: the viewer's own session may not see the approvals at all, yet their names must still go.
    const [{ data: cust }, { data: contacts }, { data: out }, { data: allApprovals }, { data: quoteNames }] = await Promise.all([
      adminPriv.from("customers").select("full_name, company_name, phone, phone2, email").eq("id", job.customer_id).maybeSingle(),
      adminPriv.from("customer_contacts").select("name, phone").eq("customer_id", job.customer_id),
      adminPriv.from("gate_outs").select("collector_name, collector_phone, delivered_to, delivery_address").eq("job_id", jobId).maybeSingle(),
      adminPriv.from("approval_requests").select("sent_to_name, sent_to_phone, approver_name").eq("job_id", jobId),
      adminPriv.from("quotations").select("approver_name, approver_phone, sent_to_name, sent_to_phone, removal_ack_name, tint_ack_name").eq("job_id", jobId),
    ]);
    secrets = [
      cust?.full_name, cust?.company_name, cust?.phone, cust?.phone2, cust?.email,
      ...(contacts ?? []).flatMap((c) => [c.name, c.phone]),
      ...(allApprovals ?? []).flatMap((a) => [a.sent_to_name, a.sent_to_phone, a.approver_name]),
      ...(quoteNames ?? []).flatMap((x) => [x.approver_name, x.approver_phone, x.sent_to_name, x.sent_to_phone, x.removal_ack_name, x.tint_ack_name]),
      priv?.location_name, priv?.location_address, privJob?.brought_by,
      out?.collector_name, out?.collector_phone, out?.delivered_to, out?.delivery_address,
    ];
  }

  const media = await loadMedia(jobId);
  const mediaUrls = await signMedia(media);
  let vehiclePhotoUrl: string | null = null;
  if (vehicle.photo_path) {
    const { data: signed } = await createAdminClient().storage.from("vehicle-photos").createSignedUrl(vehicle.photo_path, 3600);
    vehiclePhotoUrl = signed?.signedUrl ?? null;
  }

  // Names for the people in the log (readable by every role).
  const ids = new Set<string>();
  for (const e of events ?? []) {
    for (const x of [e.created_by, e.from_staff, e.to_staff]) if (x) ids.add(x);
  }
  if (job.assigned_to) ids.add(job.assigned_to);
  ids.add(job.gated_in_by);
  if (job.gated_out_by) ids.add(job.gated_out_by);
  const admin = createAdminClient();
  const { data: people } = ids.size
    ? await admin.from("staff").select("id, display_name").in("id", Array.from(ids))
    : { data: [] as { id: string; display_name: string }[] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name]));

  return {
    job: job as JobRow,
    vehicle: vehicle as unknown as JobCard["vehicle"],
    customer: full ? ((customer as JobCard["customer"]) ?? null) : null,
    vip: vip ? { is_vip: !!vip.is_vip, vip_note: full ? (vip.vip_note ?? null) : null } : null,
    customerPublic: full ? ((customerPublic as JobCard["customerPublic"]) ?? null) : null,
    gateIn: (gateIn as GateInRow | null) ?? null,
    requests: ((requests ?? []) as JobRequestRow[]),
    media,
    mediaUrls,
    vehiclePhotoUrl,
    events: ((events ?? []) as JobEventRow[]).map((e) => ({
      ...e,
      note: full ? e.note : e.note ? redactCustomer(e.note, secrets) : e.note,
      by_name: e.created_by ? (nameOf.get(e.created_by) ?? null) : null,
      from_name: e.from_staff ? (nameOf.get(e.from_staff) ?? null) : null,
      to_name: e.to_staff ? (nameOf.get(e.to_staff) ?? null) : null,
    })),
    approvals: ((approvals ?? []) as ApprovalRequestRow[]).map((a) => (full ? a : ({ ...a, sent_to_name: null, sent_to_phone: "", approver_name: null } as unknown as ApprovalRequestRow))),
    gateOut: (gateOut as GateOutRow | null) ?? null,
    assignee: job.assigned_to ? { id: job.assigned_to, display_name: nameOf.get(job.assigned_to) ?? "Unknown" } : null,
    gatedInBy: nameOf.get(job.gated_in_by) ?? null,
    gatedOutBy: job.gated_out_by ? (nameOf.get(job.gated_out_by) ?? null) : null,
  };
}

export function vehicleTitle(v: JobCard["vehicle"]) {
  if (v.kind === "loose") return "Loose items, no car";
  return [v.make?.name, v.model?.name, v.variant, v.model_year].filter(Boolean).join(" ") || "Make and model not set";
}
