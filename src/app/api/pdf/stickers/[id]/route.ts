import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { HANDOVER_SELECT, type HandoverRow } from "@/lib/handover";
import { renderStickersPdf, type PdfSticker } from "@/lib/pdf/sticker-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { qrUrl, serviceStickerDefaults, serviceWhatsAppUrl, stickerSettings, warrantyMonthsFor, type ServiceStickerData } from "@/lib/stickers";
import { formatPlate } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { batteryLine } from "@/components/StickerArt";

export const dynamic = "force-dynamic";

/** The stickers of a handover (id) or the service sticker of a job (service-<jobId>) as a PDF, the fallback when the print dialog will not do. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const staff = await getCurrentStaff();
  if (!staff) return new NextResponse("Please sign in.", { status: 401 });
  const role = staff.role_id as RoleId;
  const admin = createAdminClient();
  const settings = await getSettings();
  const ss = stickerSettings(settings);
  const out: PdfSticker[] = [];
  if (id.startsWith("service-")) {
    const jobId = id.slice("service-".length);
    if (!(["owner", "gate_in", "parts", "service_advisor"].includes(role) || can(role, "manageWork"))) return new NextResponse("Not allowed.", { status: 403 });
    const [{ data: job }, { data: gateIn }] = await Promise.all([
      admin.from("jobs").select("id, job_number, vehicle_id, work_started_at, plan_released_at, gated_in_at, service_sticker, vehicle:vehicles(vin, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant)").eq("id", jobId).maybeSingle(),
      admin.from("gate_ins").select("mileage, mileage_unit").eq("job_id", jobId).maybeSingle(),
    ]);
    if (!job) return new NextResponse("Not found.", { status: 404 });
    const j = job as unknown as { work_started_at: string | null; plan_released_at: string | null; gated_in_at: string; service_sticker: ServiceStickerData | null; vehicle: { vin: string | null } | null; job_number: string };
    const d = serviceStickerDefaults(ss, j, gateIn, new Date().toISOString().slice(0, 10));
    const unit = d.mileage_unit === "miles" ? "miles" : "km";
    const plateRow = (job as unknown as { vehicle: Parameters<typeof formatPlate>[0] | null }).vehicle;
    const plate = plateRow ? formatPlate(plateRow) : "";
    out.push({ kind: "service", w: ss.serviceW, h: ss.serviceH, plate, scanLine: ss.wording.service_scan, servicedOn: formatDate(d.serviced_on), mileage: d.mileage ? `${d.mileage.toLocaleString("en-GB")} ${unit}` : "", nextDate: formatDate(d.next_date), nextMileage: d.next_mileage ? `${d.next_mileage.toLocaleString("en-GB")} ${unit}` : "", vin: j.vehicle?.vin ?? "", title: ss.wording.service, band: ss.wording.service_band, phone: ss.servicePhone ? ss.phone : null, qr: serviceWhatsAppUrl(ss, plate) });
    return pdfResponse(await renderStickersPdf(out), `OFJ service sticker ${j.job_number}.pdf`);
  }
  if (!(can(role, "managePurchaseOrders") || role === "owner")) return new NextResponse("Not allowed.", { status: 403 });
  const { data: raw } = await admin.from("part_handovers").select(HANDOVER_SELECT + ", job:jobs(job_number, vehicle:vehicles(vin))").eq("id", id).maybeSingle();
  if (!raw) return new NextResponse("Not found.", { status: 404 });
  const h = raw as unknown as HandoverRow & { job: { job_number: string; vehicle: { vin: string | null } | null } | null };
  const vin = h.job?.vehicle?.vin ?? "";
  const date = formatDate(h.confirmed_at ?? h.created_at);
  const planIds = Object.keys(h.stickers ?? {});
  const { data: wmRows } = planIds.length ? await admin.from("part_items").select("id, warranty_months").in("id", planIds) : { data: [] as { id: string; warranty_months: number | null }[] };
  const partMonths = new Map((wmRows ?? []).map((r) => [r.id as string, (r.warranty_months as number | null) ?? null]));
  for (const [partId, s] of Object.entries(h.stickers ?? {})) {
    const item = h.items.find((i) => i.id === partId);
    for (let n = 0; n < s.count; n++) {
      if (s.kind === "battery") {
        const months = warrantyMonthsFor(ss, s.brand, partMonths.get(partId) ?? null);
        const until = new Date(h.confirmed_at ?? h.created_at);
        until.setUTCMonth(until.getUTCMonth() + months);
        out.push({ kind: "battery", w: ss.batteryW, h: ss.batteryH, months, installed: date, until: formatDate(until.toISOString()), vin, title: ss.wording.battery, valid: ss.wording.battery_valid, qr: qrUrl(s.code), line: batteryLine(item?.description, s.brand, s.model) });
      } else out.push({ kind: "part", w: ss.partW, h: ss.partH, qr: qrUrl(s.code), jobNumber: h.job?.job_number ?? "", name: item?.description ?? "Part", index: n + 1, count: s.count, date });
    }
  }
  return pdfResponse(await renderStickersPdf(out), `OFJ stickers ${h.job?.job_number ?? ""}.pdf`);
}
