import { NextResponse, type NextRequest } from "next/server";
import { clockIn, clockOut, openClockingOf, pausedTodayOf } from "@/lib/bodyshop";
import { CLOSE_DONE, CLOSE_MOVED, clockWords, isPauseReason, pauseClose, type PauseReason } from "@/lib/clock-choice";
import { receivePartsByTechnician } from "@/lib/handover";
import { getSettings } from "@/lib/settings";
import { getCurrentDevice } from "@/lib/devices";
import { verifyPin } from "@/lib/pin";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintGrant } from "@/lib/upload-grant";
import { JOB_FILES_BUCKET } from "@/lib/work-data";
import { photoSizesLater } from "@/lib/photo-sizes";

export const dynamic = "force-dynamic";

/** The words on the tint photo's job file: the bodyshop page and the tint card find the photo by them. */
const TINT_CAPTION = "Tint fitted";

/** The car's stage the tint photo belongs to: the tint stage, or the PPF install it is merged into ("PPF install and tint"). */
async function tintStageOf(jobId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("bodyshop_stages").select("id, key, status").eq("job_id", jobId).eq("is_active", true).in("key", ["tint", "ppf"]).neq("status", "skipped").order("position");
  const rows = (data ?? []) as { id: string; key: string }[];
  return (rows.find((s) => s.key === "tint") ?? rows.find((s) => s.key === "ppf"))?.id ?? null;
}

/** The section tablet's clock in / clock out: a registered device, a bodyshop person and their PIN. No session is made. */
export async function POST(request: NextRequest) {
  const device = await getCurrentDevice();
  if (!device) return NextResponse.json({ error: "This tablet is not registered." }, { status: 403 });
  // A tablet opened before 31 October 2026 sends the tint photo with the PIN, as a form; everything else is JSON.
  const isForm = (request.headers.get("content-type") ?? "").includes("multipart/form-data");
  const form = isForm ? await request.formData().catch(() => null) : null;
  const body = (form ? { jobId: form.get("jobId"), staffId: form.get("staffId"), pin: form.get("pin"), action: form.get("action") } : await request.json().catch(() => ({}))) as { jobId?: string; staffId?: string; pin?: string; action?: string; partIds?: string[]; reason?: string };
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
    const stageId = await tintStageOf(job.id as string);
    if (form) {
      // An older tablet page: the photo came with the PIN.
      const file = form.get("photo");
      if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "Take the photo first." }, { status: 400 });
      if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "The photo is too large. Take it again." }, { status: 400 });
      const type = file.type && file.type.startsWith("image/") ? file.type : "image/jpeg";
      const path = `${jobId}/bodyshop/tint-fitted-${Date.now()}.${type === "image/png" ? "png" : "jpg"}`;
      const up = await admin.storage.from(JOB_FILES_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: type, upsert: false });
      if (up.error) return NextResponse.json({ error: "The photo did not upload. Try again." }, { status: 500 });
      photoSizesLater(JOB_FILES_BUCKET, path, type);
      const { error: rowError } = await admin.from("job_files").insert({ job_id: jobId, kind: "bodyshop_photo", ref_id: stageId, storage_path: path, content_type: type, caption: TINT_CAPTION, uploaded_by: staffId, created_by: staffId, updated_by: staffId });
      if (rowError) return NextResponse.json({ error: "The photo was not saved. Try again." }, { status: 500 });
      await admin.from("job_events").insert({ job_id: jobId, event_type: "tint_photo", note: `Tint fitted: photo taken by ${person.display_name} on the PPF tablet`, created_by: staffId });
      return NextResponse.json({ ok: true, message: `${person.display_name}: tint photo saved.` });
    }
    // 31 October 2026: the PIN is checked and the step recorded here; the photo follows from the tablet through the send
    // queue (kept on the tablet until the server has it, no signal is fine), recorded under this person with a permit
    // for this car only. The PIN never goes into the queue.
    await admin.from("job_events").insert({ job_id: jobId, event_type: "tint_photo", note: `Tint fitted: photo taken by ${person.display_name} on the PPF tablet`, created_by: staffId });
    const { grant, expiresAt } = mintGrant({ t: "job_file", s: String(job.id).toLowerCase(), u: person.id as string, via: "pin" });
    return NextResponse.json({ ok: true, message: `${person.display_name}: tint photo saved on this tablet – sending…`, grant, expiresAt, stageId, caption: TINT_CAPTION });
  }
  // CLOCKING: START / PAUSE / STOP AFTER THE PIN (10 November 2026, Section 7). "check" only reads where the person is;
  // nothing changes until Start, Pause (with its reason) or Stop is pressed. One car at a time per person.
  const carWords = async (id: string) => {
    const { data: j } = await admin.from("jobs").select("job_number, vehicle:vehicles(make:vehicle_makes(name), model:vehicle_models(name))").eq("id", id).maybeSingle();
    const v = (j as { job_number?: string; vehicle?: { make?: { name?: string } | null; model?: { name?: string } | null } | null } | null)?.vehicle;
    return [v?.make?.name, v?.model?.name].filter(Boolean).join(" ") || String((j as { job_number?: string } | null)?.job_number ?? "the car");
  };
  if (body.action === "check") {
    const open = await openClockingOf(staffId);
    const paused = (await pausedTodayOf([staffId])).get(staffId) ?? null;
    return NextResponse.json({ ok: true, state: { onThisCar: open?.job_id === jobId, onOtherCar: open && open.job_id !== jobId ? await carWords(open.job_id) : null, pausedHere: paused && paused.jobId === jobId && !open ? paused.reason : null } });
  }
  if (body.action === "pause" || body.action === "stop") {
    const open = await openClockingOf(staffId);
    if (open?.job_id !== jobId) return NextResponse.json({ error: `${person.display_name} is not clocked on this car.` }, { status: 400 });
    const reason = String(body.reason ?? "").trim();
    if (body.action === "pause" && !isPauseReason(reason)) return NextResponse.json({ error: "Tap why you pause." }, { status: 400 });
    await clockOut(staffId, staffId, body.action === "pause" ? pauseClose(reason as PauseReason) : CLOSE_DONE);
    const car = await carWords(jobId);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "bodyshop_clock", note: body.action === "pause" ? `${person.display_name}: paused (${reason}) on the tablet` : `${person.display_name}: my part is done (tablet)`, created_by: staffId });
    return NextResponse.json({ ok: true, message: clockWords(person.display_name, body.action, car, { reason }) });
  }
  if (body.action === "start") {
    const open = await openClockingOf(staffId);
    const wasPaused = (await pausedTodayOf([staffId])).get(staffId) ?? null;
    let movedFrom: string | null = null;
    if (open && open.job_id !== jobId) {
      movedFrom = await carWords(open.job_id);
      await clockOut(staffId, staffId, CLOSE_MOVED);
      await admin.from("job_events").insert({ job_id: open.job_id, event_type: "bodyshop_clock", note: `${person.display_name}: paused (moved to another car)`, created_by: staffId });
    } else if (open) {
      return NextResponse.json({ ok: true, message: `${person.display_name}: already on this car.` });
    }
    const r = await clockIn(jobId, staffId, "tablet", staffId);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    const startWords = clockWords(person.display_name, "start", await carWords(jobId), { movedFrom, back: wasPaused?.jobId === jobId });
    return NextResponse.json({ ok: true, message: r.stage ? startWords.replace(/\.$/,` · ${r.stage}.`) : startWords });
  }
  if (body.action === "out") {
    const { minutes } = await clockOut(staffId, staffId);
    return NextResponse.json({ ok: true, message: `${person.display_name} clocked out (${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min).` });
  }
  const r = await clockIn(jobId, staffId, "tablet", staffId);
  return NextResponse.json({ ok: true, message: `${person.display_name} clocked in${r.stage ? ` · ${r.stage}` : ""}.` });
}
