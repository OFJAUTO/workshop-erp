import { NextResponse, type NextRequest } from "next/server";
import { clockIn, clockOut } from "@/lib/bodyshop";
import { receivePartsByTechnician } from "@/lib/handover";
import { getSettings } from "@/lib/settings";
import { getCurrentDevice } from "@/lib/devices";
import { verifyPin } from "@/lib/pin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The section tablet's clock in / clock out: a registered device, a bodyshop person and their PIN. No session is made. */
export async function POST(request: NextRequest) {
  const device = await getCurrentDevice();
  if (!device) return NextResponse.json({ error: "This tablet is not registered." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { jobId?: string; staffId?: string; pin?: string; action?: string; partIds?: string[] };
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
  if (body.action === "out") {
    const { minutes } = await clockOut(staffId, staffId);
    return NextResponse.json({ ok: true, message: `${person.display_name} clocked out (${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min).` });
  }
  const r = await clockIn(jobId, staffId, "tablet", staffId);
  return NextResponse.json({ ok: true, message: `${person.display_name} clocked in${r.stage ? ` · ${r.stage}` : ""}.` });
}
