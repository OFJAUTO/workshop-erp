import { NextResponse, type NextRequest } from "next/server";
import { clockIn, clockOut } from "@/lib/bodyshop";
import { receivePartsByTechnician } from "@/lib/handover";
import { getSettings } from "@/lib/settings";
import { getCurrentDevice } from "@/lib/devices";
import { verifyPin } from "@/lib/pin";
import { createAdminClient } from "@/lib/supabase/admin";
import { JOB_FILES_BUCKET } from "@/lib/work-data";

export const dynamic = "force-dynamic";

/** The section tablet's clock in / clock out: a registered device, a bodyshop person and their PIN. No session is made. */
export async function POST(request: NextRequest) {
  const device = await getCurrentDevice();
  if (!device) return NextResponse.json({ error: "This tablet is not registered." }, { status: 403 });
  // A photo (section 11: the tint after fitting) arrives as a form; everything else as JSON.
  const isForm = (request.headers.get("content-type") ?? "").includes("multipart/form-data");
  const form = isForm ? await request.formData().catch(() => null) : null;
  const body = (form ? { jobId: form.get("jobId"), staffId: form.get("staffId"), pin: form.get("pin"), action: form.get("action") } : await request.json().catch(() => ({}))) as { jobId?: string; staffId?: string; pin?: string; action?: string; partIds?: string[] };
  const jobId = String(body.jobId ?? "");
  const staffId = String(body.staffId ?? "");
  const pin = String(body.pin ?? "").trim();
  if (!jobId || !staffId) return NextResponse.json({ error: "Pick the car and your name." }, { status: 400 });
  const admin = createAdminClient();
  const [{ data: person }, { data: priv }, { data: job }] = await Promise.all([
    admin.from("staff").select("id, display_name, role_id, department_id, is_active").eq("id", staffId).maybeSingle(),
    admin.from("staff_private").select("pin_hash").eq("staff_id", staffId).maybeSingle(),
    admin.from("jobs").select("id, is_open, department").eq("id", jobId).maybeSingle(),
  ]);
  if (!person || !person.is_active || !["bodyshop", "paint", "ppf_tint", "detailing"].includes(person.department_id ?? "")) return NextResponse.json({ error: "Not a bodyshop person." }, { status: 403 });
  if (!verifyPin(pin, priv?.pin_hash)) return NextResponse.json({ error: "Wrong PIN." }, { status: 403 });
  if (!job || !job.is_open) return NextResponse.json({ error: "This car is not in the workshop." }, { status: 400 });
  await admin.from("devices").update({ last_seen_at: new Date().toISOString(), last_staff_id: staffId }).eq("id", device.id);
  if (body.action === "receive_parts") {
    const settings = await getSettings();
    const ids = Array.isArray(body.partIds) ? body.partIds.map(String).filter(Boolean) : [];
    const r = await receivePartsByTechnician(jobId, { technicianId: staffId, partIds: ids, pin, deviceId: device.id }, { id: staffId, display_name: person.display_name, role_id: String(person.role_id ?? "technician") }, settings);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, message: `${person.display_name}: ${r.message ?? "parts received."}` });
  }
  if (body.action === "tint_photo") {
    const file = form?.get("photo");
    if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "Take the photo first." }, { status: 400 });
    if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "The photo is too large. Take it again." }, { status: 400 });
    const type = file.type && file.type.startsWith("image/") ? file.type : "image/jpeg";
    const path = `${jobId}/bodyshop/tint-fitted-${Date.now()}.${type === "image/png" ? "png" : "jpg"}`;
    const up = await admin.storage.from(JOB_FILES_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: type, upsert: false });
    if (up.error) return NextResponse.json({ error: "The photo did not upload. Try again." }, { status: 500 });
    const { error: rowError } = await admin.from("job_files").insert({ job_id: jobId, kind: "bodyshop_photo", storage_path: path, content_type: type, caption: "Tint fitted", uploaded_by: staffId, created_by: staffId, updated_by: staffId });
    if (rowError) return NextResponse.json({ error: rowError.message }, { status: 500 });
    await admin.from("job_events").insert({ job_id: jobId, event_type: "tint_photo", note: `Tint fitted: photo taken by ${person.display_name} on the PPF tablet`, created_by: staffId });
    return NextResponse.json({ ok: true, message: `${person.display_name}: tint photo saved.` });
  }
  if (body.action === "out") {
    const { minutes } = await clockOut(staffId, staffId);
    return NextResponse.json({ ok: true, message: `${person.display_name} clocked out (${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min).` });
  }
  const r = await clockIn(jobId, staffId, "tablet", staffId);
  return NextResponse.json({ ok: true, message: `${person.display_name} clocked in${r.stage ? ` · ${r.stage}` : ""}.` });
}
