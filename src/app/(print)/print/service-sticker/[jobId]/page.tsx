import { notFound } from "next/navigation";
import { ServiceSticker, stickerPageCss } from "@/components/StickerArt";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { qrDataUrl } from "@/lib/pdf/qr";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { ensureQrLink, qrUrl, serviceStickerDefaults, stickerSettings, type ServiceStickerData, stickerLogoDataUrl } from "@/lib/stickers";
import { createAdminClient } from "@/lib/supabase/admin";
import { PrintNow } from "../../../parts/labels/[jobId]/PrintNow";

export const dynamic = "force-dynamic";

/** The oil service sticker of one job at its exact size. Opening it counts as printing; the next service lands on the car's record. */
export default async function ServiceStickerPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ back?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(["owner", "gate_in", "parts", "service_advisor"].includes(role) || can(role, "manageWork"))) notFound();
  const { jobId } = await params;
  const { back } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const ss = stickerSettings(settings);
  const logo = await stickerLogoDataUrl(ss);
  const [{ data: job }, { data: gateIn }] = await Promise.all([
    admin.from("jobs").select("id, job_number, vehicle_id, work_started_at, plan_released_at, gated_in_at, service_sticker, vehicle:vehicles(vin, mileage_unit)").eq("id", jobId).maybeSingle(),
    admin.from("gate_ins").select("mileage, mileage_unit").eq("job_id", jobId).maybeSingle(),
  ]);
  if (!job) notFound();
  const j = job as unknown as { id: string; job_number: string; vehicle_id: string; work_started_at: string | null; plan_released_at: string | null; gated_in_at: string; service_sticker: ServiceStickerData | null; vehicle: { vin: string | null; mileage_unit: string } | null };
  const today = new Date().toISOString().slice(0, 10);
  const data = serviceStickerDefaults(ss, j, gateIn, today);
  const code = data.qr_code ?? (await ensureQrLink("service", { jobId, vehicleId: j.vehicle_id, refId: j.vehicle_id }, staff.id));
  const first = !data.printed_at;
  const saved: ServiceStickerData = { ...data, qr_code: code, printed_at: data.printed_at ?? new Date().toISOString(), printed_by: data.printed_by ?? staff.id };
  await admin.from("jobs").update({ service_sticker: saved, updated_by: staff.id }).eq("id", jobId);
  await admin.from("vehicles").update({ next_service_date: saved.next_date, next_service_mileage: saved.next_mileage, updated_by: staff.id }).eq("id", j.vehicle_id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: first ? "sticker_printed" : "sticker_reprint", note: `Oil service sticker ${first ? "printed" : "printed again"} by ${staff.display_name}: next ${saved.next_date}${saved.next_mileage ? ` or ${saved.next_mileage} ${saved.mileage_unit}` : ""}`, created_by: staff.id });
  const qr = await qrDataUrl(qrUrl(code), 300);
  const unit = saved.mileage_unit === "miles" ? "miles" : "km";
  return (
    <div>
      <style>{stickerPageCss(ss.large, ss.large)}</style>
      <div className="bar">
        <span>Oil service sticker · {j.job_number}{first ? "" : " · printed again"}</span>
        <PrintNow />
        <a href={`/api/pdf/stickers/service-${jobId}`}>Download PDF</a>
        <a href={back || `/jobs/${jobId}`} style={{ marginLeft: "auto" }}>Back</a>
      </div>
      <ServiceSticker size={ss.large} logoUrl={logo} d={{ qr, servicedOn: formatDate(saved.serviced_on), mileage: saved.mileage ? `${saved.mileage.toLocaleString("en-GB")} ${unit}` : "", nextDate: formatDate(saved.next_date), nextMileage: saved.next_mileage ? `${saved.next_mileage.toLocaleString("en-GB")} ${unit}` : "", vin: j.vehicle?.vin ?? "", title: ss.wording.service, band: ss.wording.service_band, phone: ss.servicePhone ? ss.phone : null }} />
    </div>
  );
}
