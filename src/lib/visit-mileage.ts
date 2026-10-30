import "server-only";
import { GATE_IN_BUCKET } from "./media";
import { thumbsFor } from "./media-urls";
import { mileageInOut, mileageLine, unreadableLabel, type MileageInOut, type MileageUnit } from "./mileage";
import { createAdminClient } from "./supabase/admin";
import { JOB_FILES_BUCKET } from "./work-data";

export type MileagePhoto = { id: string; url: string; thumb: string | null; label: string; at: string | null };
export type VisitMileage = { io: MileageInOut; line: string; note: string | null; inPhoto: MileagePhoto | null; outPhoto: MileagePhoto | null };

/**
 * One visit's mileage (30 October 2026, batch 2 section 2): the gate-in reading with its dashboard photo, the final
 * reading at gate-out with the photo of the instrument cluster, and what was driven while with us. ONE loader for the
 * job card (both photos, internal) and the customer's invoice (`withPhotos: false` - the words only, never a photo).
 */
export async function loadVisitMileage(jobId: string, opts: { withPhotos?: boolean } = {}): Promise<VisitMileage | null> {
  const admin = createAdminClient();
  const [{ data: gi }, { data: go }] = await Promise.all([
    admin.from("gate_ins").select("mileage, mileage_unit, mileage_miles").eq("job_id", jobId).maybeSingle(),
    admin.from("gate_outs").select("mileage_out, mileage_out_unit, mileage_out_miles, mileage_unreadable_reason, mileage_unreadable_note, odometer_file_id, created_at").eq("job_id", jobId).maybeSingle(),
  ]);
  if (!gi) return null;
  const unit: MileageUnit = gi.mileage_unit === "mi" ? "mi" : "km";
  const io = mileageInOut({ inKm: gi.mileage, inMiles: gi.mileage_miles, outKm: go?.mileage_out ?? null, outMiles: go?.mileage_out_miles ?? null, unit, unreadable: go?.mileage_unreadable_reason ?? null });
  const note = go?.mileage_unreadable_reason ? [unreadableLabel(go.mileage_unreadable_reason), go.mileage_unreadable_note].filter(Boolean).join(": ") : null;
  if (opts.withPhotos === false) return { io, line: mileageLine(io), note, inPhoto: null, outPhoto: null };
  const [{ data: dash }, { data: odo }] = await Promise.all([
    admin.from("gate_in_media").select("id, storage_path, created_at").eq("job_id", jobId).eq("kind", "dashboard_photo").is("removed_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    go?.odometer_file_id ? admin.from("job_files").select("id, storage_path, created_at").eq("id", go.odometer_file_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const photo = async (bucket: string, row: { id: string; storage_path: string; created_at: string } | null, label: string): Promise<MileagePhoto | null> => {
    if (!row) return null;
    const { data } = await admin.storage.from(bucket).createSignedUrl(row.storage_path, 3600);
    if (!data?.signedUrl) return null;
    const thumb = (await thumbsFor(bucket, [row.storage_path], 480)).get(row.storage_path) ?? null;
    return { id: row.id, url: data.signedUrl, thumb, label, at: row.created_at };
  };
  const [inPhoto, outPhoto] = await Promise.all([photo(GATE_IN_BUCKET, dash as never, "Dashboard at gate-in"), photo(JOB_FILES_BUCKET, odo as never, "Dashboard at gate-out")]);
  return { io, line: mileageLine(io), note, inPhoto, outPhoto };
}
