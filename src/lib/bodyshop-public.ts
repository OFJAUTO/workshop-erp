import "server-only";
import { ppfWarrantyWords } from "./ppf-cut-data";
import { addDaysIso } from "./bodyshop-kinds";
import { JOB_SELECT, approvedKinds, type BodyshopJobRow } from "./bodyshop";
import { signCarPictures } from "./car-pictures";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";
import { JOB_FILES_BUCKET } from "./work-data";
import { thumbsFor } from "./media-urls";

export type HandoverData = {
  job: BodyshopJobRow;
  customer: { full_name: string; company_name: string | null; phone: string | null } | null;
  kinds: string[];
  filmText: string;
  beforeUrl: string | null;
  afterUrl: string | null;
  /** Small pictures for the page (the viewer opens the sharp ones). */
  beforeThumb: string | null;
  afterThumb: string | null;
  finalCheck: string | null;
  advisor: { name: string; phone: string | null } | null;
  warranty: { certificateNo: string; installDate: string; validUntil: string } | null;
  carTitle: string;
  plate: string | null;
};

/** Everything the customer's handover page and the warranty certificate show, from the job's handover token. */
export async function loadHandover(token: string, settings: Settings): Promise<HandoverData | null> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("jobs").select(JOB_SELECT).eq("bodyshop_handover_token", token).maybeSingle();
  if (!raw) return null;
  const job = raw as unknown as BodyshopJobRow;
  const [{ data: customer }, approved, { data: after }, { data: appt }, { data: advisor }] = await Promise.all([
    admin.from("customers").select("full_name, company_name, phone").eq("id", job.customer_id).maybeSingle(),
    approvedKinds(job.id),
    job.bodyshop_after_photo_id ? admin.from("job_files").select("storage_path").eq("id", job.bodyshop_after_photo_id).maybeSingle() : Promise.resolve({ data: null }),
    job.final_check_appointment_id ? admin.from("appointments").select("starts_at, status").eq("id", job.final_check_appointment_id).maybeSingle() : Promise.resolve({ data: null }),
    job.gated_in_by ? admin.from("staff").select("display_name, staff_private(phone)").eq("id", job.gated_in_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const pictures = await signCarPictures([job.vehicle?.photo_path]);
  const beforeUrl = job.vehicle?.photo_path ? (pictures.get(job.vehicle.photo_path) ?? null) : null;
  let afterUrl: string | null = null;
  if (after?.storage_path) {
    const { data: signed } = await admin.storage.from(JOB_FILES_BUCKET).createSignedUrl(after.storage_path as string, 3600);
    afterUrl = signed?.signedUrl ?? null;
  }
  const [beforeThumbs, afterThumbs] = await Promise.all([thumbsFor("vehicle-photos", [job.vehicle?.photo_path], 960), thumbsFor(JOB_FILES_BUCKET, [after?.storage_path as string | undefined], 960)]);
  const ppf = approved.kinds.includes("ppf") || approved.kinds.includes("coloured_ppf");
  const installDate = (job.gated_out_at ?? new Date().toISOString()).slice(0, 10);
  const years = Number(settings.ppf_warranty_years) || 10;
  const validUntil = `${Number(installDate.slice(0, 4)) + years}${installDate.slice(4)}`;
  const brand = String(settings.ppf_brand_name || "OFJ Bespoke PPF");
  // "OFJ Bespoke PPF – Gloss · Hand-cut · Full body · 10-year warranty" - brand, finish, cutting method, coverage, years.
  const filmText = (await ppfWarrantyWords(job.id, brand, approved.film ?? null, years)) ?? (approved.kinds.includes("coloured_ppf") ? `${brand} coloured film${approved.film?.colour ? ` · ${approved.film.colour}` : ""}${approved.film?.code ? ` (${approved.film.code})` : ""}` : `${brand} clear film`);
  const v = job.vehicle;
  const adv = advisor as unknown as { display_name: string; staff_private: { phone: string | null } | { phone: string | null }[] | null } | null;
  const advPhone = adv ? (Array.isArray(adv.staff_private) ? adv.staff_private[0]?.phone : adv.staff_private?.phone) ?? null : null;
  return {
    job,
    customer: (customer as HandoverData["customer"]) ?? null,
    kinds: approved.kinds,
    filmText,
    beforeUrl,
    afterUrl,
    beforeThumb: job.vehicle?.photo_path ? (beforeThumbs.get(job.vehicle.photo_path) ?? null) : null,
    afterThumb: after?.storage_path ? (afterThumbs.get(after.storage_path as string) ?? null) : null,
    finalCheck: appt && (appt as { status: string }).status !== "cancelled" ? ((appt as { starts_at: string }).starts_at ?? null) : null,
    advisor: adv ? { name: adv.display_name, phone: advPhone } : null,
    warranty: ppf ? { certificateNo: `W-${job.job_number.replace(/^J-/, "")}`, installDate, validUntil } : null,
    carTitle: [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" ") || "Your car",
    plate: v?.has_plate ? formatPlate(v) : null,
  };
}

/** A customer update by its token: the car, the one photo, the words, and the handover link when the car is ready. */
export async function loadUpdate(token: string) {
  const admin = createAdminClient();
  const { data: u } = await admin.from("bodyshop_updates").select("id, job_id, kind, photo_id, sent_at").eq("token", token).eq("is_active", true).maybeSingle();
  if (!u) return null;
  const { data: raw } = await admin.from("jobs").select(JOB_SELECT).eq("id", u.job_id).maybeSingle();
  if (!raw) return null;
  const job = raw as unknown as BodyshopJobRow;
  let photoUrl: string | null = null;
  let photoThumb: string | null = null;
  if (u.photo_id) {
    const { data: f } = await admin.from("job_files").select("storage_path").eq("id", u.photo_id).maybeSingle();
    if (f?.storage_path) {
      const { data: signed } = await admin.storage.from(JOB_FILES_BUCKET).createSignedUrl(f.storage_path as string, 3600);
      photoUrl = signed?.signedUrl ?? null;
      photoThumb = (await thumbsFor(JOB_FILES_BUCKET, [f.storage_path as string], 960)).get(f.storage_path as string) ?? null;
    }
  }
  if (!photoUrl && job.vehicle?.photo_path) {
    photoUrl = (await signCarPictures([job.vehicle.photo_path])).get(job.vehicle.photo_path) ?? null;
    photoThumb = (await thumbsFor("vehicle-photos", [job.vehicle.photo_path], 960)).get(job.vehicle.photo_path) ?? null;
  }
  const v = job.vehicle;
  return { kind: u.kind as "arrived" | "film" | "ready", job, photoUrl, photoThumb, carTitle: [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" ") || "Your car", plate: v?.has_plate ? formatPlate(v) : null, handoverToken: job.bodyshop_handover_token };
}

export const tomorrowIso = () => addDaysIso(new Date().toISOString().slice(0, 10), 1);
