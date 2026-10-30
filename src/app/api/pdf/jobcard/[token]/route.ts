import { NextResponse, type NextRequest } from "next/server";
import { damageCountWords } from "@/lib/damage";
import { loadCarDamage } from "@/lib/damage-data";
import { formatDate, formatDateTime } from "@/lib/format";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { ARRIVED_BY, CLEANLINESS, CONDITIONS, FUEL_LEVELS, feeNotice, labelOf } from "@/lib/jobs";
import { describeMileage } from "@/lib/mileage";
import { damagePdfData } from "@/lib/pdf/damage-pdf";
import { renderGateInPdf } from "@/lib/pdf/gate-in-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The customer's copy of the job card (section 4, 30 October 2026), opened from the View button on their link: the car,
 * the check-in details, "Damage already on the car" with the outline, the list and each panel's photos, the requests and
 * the approval. No staff names, nothing internal; the link's token is the key.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const admin = createAdminClient();
  const { data: req } = await admin.from("approval_requests").select("id, job_id, approved_at, approver_name, inspection_fee_notice, no_fee").eq("token", token).maybeSingle();
  if (!req) return new NextResponse("This link is not valid.", { status: 404 });
  const card = await loadJobCard(admin, req.job_id, { customerPage: true });
  if (!card || !card.gateIn) return new NextResponse("This job card is no longer available.", { status: 404 });
  const { job, vehicle, gateIn, requests, media, mediaUrls } = card;
  const settings = await getSettings();
  const damage = await loadCarDamage(job.id, { media, urls: mediaUrls });
  const location = gateIn.location_type === "branch" ? (gateIn.location_name ?? "") : [gateIn.location_name, gateIn.location_address].filter(Boolean).join(", ");
  const details = ([
    ["Received at", location],
    ["Arrived by", labelOf(ARRIVED_BY, gateIn.arrived_by)],
    ["Condition on arrival", labelOf(CONDITIONS, gateIn.condition)],
    [vehicle.fuel_type === "electric" ? "Battery" : "Fuel level", vehicle.fuel_type === "electric" ? (gateIn.battery_percent != null ? `${gateIn.battery_percent}%` : "") : labelOf(FUEL_LEVELS, gateIn.fuel_level)],
    ["Cleanliness", labelOf(CLEANLINESS, gateIn.cleanliness)],
    ["Damage noted", damageCountWords(damage)],
    ["Mileage", describeMileage(gateIn.mileage, gateIn.mileage_unit ?? "km")],
    ["Keys received", `${gateIn.keys_count} key${gateIn.keys_count === 1 ? "" : "s"}, ${gateIn.keys_keychain ? "with keychain" : "no keychain"}`],
    ["Old parts returned to you", gateIn.old_parts_return ? "Yes" : "No"],
    ["Promised date", job.promised_at ? formatDate(job.promised_at + "T12:00:00+04:00") : "To be confirmed after the inspection"],
  ] as [string, string][]).filter(([, v]) => v);
  const noFee = (req as { no_fee?: boolean }).no_fee === true;
  const pdf = await renderGateInPdf({
    customer: true,
    jobNumber: job.job_number,
    plate: formatPlate(vehicle),
    car: vehicleTitle(vehicle),
    vin: vehicle.vin,
    colour: vehicle.colour,
    customerName: card.customer?.company_name ?? card.customer?.full_name ?? "Customer",
    customerPhone: null,
    customerNumber: null,
    gatedIn: formatDateTime(job.gated_in_at),
    gatedInBy: "",
    details,
    requests: requests.map((r) => r.text),
    approval: req.approved_at ? `Approved by ${req.approver_name ?? "the customer"} on ${formatDateTime(req.approved_at)}.` : "Not approved yet.",
    feeLine: noFee ? "" : (req.inspection_fee_notice ?? feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed)),
    gateOut: null,
    photos: [],
    videoCount: 0,
    damage: await damagePdfData(damage),
    printedBy: "",
    printedAt: "",
  });
  return pdfResponse(pdf, `OFJ Job card ${job.job_number}.pdf`);
}
