import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./supabase/admin";
import { loadMedia, signMedia } from "./media";
import type { ApprovalRequestRow, GateInMediaRow, GateInRow, GateOutRow, JobEventRow, JobRequestRow, JobRow } from "./types";

export type JobCard = {
  job: JobRow;
  vehicle: {
    id: string;
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
  "id, job_number, vehicle_id, customer_id, stage, status, priority, promised_at, assigned_to, assigned_at, gated_in_at, gated_in_by, gated_out_at, gated_out_by, first_approval_at, stage_entered_at, is_open, department, created_at, updated_at";

/** Everything a job card screen needs. `client` decides what the viewer may see (their own session, or the master key for public pages). */
export async function loadJobCard(client: SupabaseClient, jobId: string): Promise<JobCard | null> {
  const { data: job } = await client.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  if (!job) return null;

  const [{ data: vehicle }, { data: customer }, { data: vip }, { data: gateIn }, { data: events }, { data: approvals }, { data: gateOut }, { data: requests }] =
    await Promise.all([
      client
        .from("vehicles")
        .select("id, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, fuel_type, variant, model_year, colour, make:vehicle_makes(name), model:vehicle_models(name)")
        .eq("id", job.vehicle_id)
        .maybeSingle(),
      client
        .from("customers")
        .select("id, customer_number, full_name, company_name, phone, is_vip, vip_note")
        .eq("id", job.customer_id)
        .maybeSingle(),
      client.from("customer_vip_flags").select("is_vip, vip_note").eq("id", job.customer_id).maybeSingle(),
      client
        .from("gate_ins")
        .select("id, job_id, arrived_by, condition, fuel_level, battery_percent, cleanliness, dash_cam, major_damage, mileage, keys_count, keys_keychain, customer_requests, notes, old_parts_return, damage_note, wheels_required, location_type, location_name, location_address, location_lat, location_lng, is_complete, completed_at, created_at, updated_at")
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
        .select("id, job_id, keys_returned, keychain_returned, keys_match, keys_override_by, keys_override_reason, dash_cam_reconnected, balance_due_aed, release_approved_by, release_reason, notes, created_at")
        .eq("job_id", jobId)
        .maybeSingle(),
      client.from("job_requests").select("id, job_id, position, text, is_active").eq("job_id", jobId).eq("is_active", true).order("position"),
    ]);
  if (!vehicle) return null;

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
    customer: (customer as JobCard["customer"]) ?? null,
    vip: (vip as JobCard["vip"]) ?? null,
    gateIn: (gateIn as GateInRow | null) ?? null,
    requests: ((requests ?? []) as JobRequestRow[]),
    media,
    mediaUrls,
    vehiclePhotoUrl,
    events: ((events ?? []) as JobEventRow[]).map((e) => ({
      ...e,
      by_name: e.created_by ? (nameOf.get(e.created_by) ?? null) : null,
      from_name: e.from_staff ? (nameOf.get(e.from_staff) ?? null) : null,
      to_name: e.to_staff ? (nameOf.get(e.to_staff) ?? null) : null,
    })),
    approvals: (approvals ?? []) as ApprovalRequestRow[],
    gateOut: (gateOut as GateOutRow | null) ?? null,
    assignee: job.assigned_to ? { id: job.assigned_to, display_name: nameOf.get(job.assigned_to) ?? "Unknown" } : null,
    gatedInBy: nameOf.get(job.gated_in_by) ?? null,
    gatedOutBy: job.gated_out_by ? (nameOf.get(job.gated_out_by) ?? null) : null,
  };
}

export function vehicleTitle(v: JobCard["vehicle"]) {
  return [v.make?.name, v.model?.name, v.variant, v.model_year].filter(Boolean).join(" ") || "Make and model not set";
}
