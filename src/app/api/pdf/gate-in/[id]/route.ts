import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { ARRIVED_BY, CLEANLINESS, CONDITIONS, FUEL_LEVELS, feeNotice, labelOf } from "@/lib/jobs";
import { JOB_DEPARTMENTS } from "@/lib/inspection";
import { can, type RoleId } from "@/lib/roles";
import { describeMileage } from "@/lib/mileage";
import { renderGateInPdf } from "@/lib/pdf/gate-in-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { MEDIA_KIND_LABELS, formatPlate } from "@/lib/types";
import { isWheelKind, wheelConditionText } from "@/lib/wheels";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The internal gate-in record on paper: every detail and photo from when the car arrived. Staff only, never for a customer. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) return new NextResponse("Please sign in.", { status: 401 });
  const { id } = await context.params;
  const admin = createAdminClient();
  const card = await loadJobCard(admin, id);
  if (!card || !card.gateIn) return new NextResponse("Not found.", { status: 404 });
  const { job, vehicle, customerPublic, gateIn, requests, media, mediaUrls, approvals, gateOut } = card;
  const settings = await getSettings();

  const details: [string, string][] = [
    ["Department", JOB_DEPARTMENTS.find((d) => d.value === job.department)?.label ?? "Not set"],
    ["Location", [gateIn.location_name, gateIn.location_type !== "branch" ? gateIn.location_address : null].filter(Boolean).join(" · ")],
    ["Arrived by", labelOf(ARRIVED_BY, gateIn.arrived_by)],
    ["Condition", labelOf(CONDITIONS, gateIn.condition)],
    [vehicle.fuel_type === "electric" ? "Battery" : "Fuel level", vehicle.fuel_type === "electric" ? (gateIn.battery_percent != null ? `${gateIn.battery_percent}%` : "") : labelOf(FUEL_LEVELS, gateIn.fuel_level)],
    ["Cleanliness", labelOf(CLEANLINESS, gateIn.cleanliness)],
    ["Dash cam", gateIn.dash_cam ? "Fitted, to be disconnected" : "Not fitted"],
    ["Major damage", gateIn.major_damage ? "Yes" : "No"],
    ...(gateIn.damage_note ? ([["Damage note", gateIn.damage_note]] as [string, string][]) : []),
    ["Mileage", describeMileage(gateIn.mileage, gateIn.mileage_unit ?? "km")],
    ["Keys", `${gateIn.keys_count} key${gateIn.keys_count === 1 ? "" : "s"}, ${gateIn.keys_keychain ? "with keychain" : "no keychain"}`],
    ["Old parts returned to customer", gateIn.old_parts_return ? "Yes" : "No"],
    ...(gateIn.notes ? ([["Notes", gateIn.notes]] as [string, string][]) : []),
  ].filter(([, v]) => v !== "") as [string, string][];

  const approved = approvals.find((a) => a.approved_at) ?? null;
  const latest = approvals[0] ?? null;
  const approval = approved
    ? `Approved by ${approved.approver_name ?? approved.sent_to_name ?? "the customer"} on ${formatDateTime(approved.approved_at!)}.`
    : latest
      ? `Link created ${formatDateTime(latest.created_at)}${latest.sent_at ? `, sent ${formatDateTime(latest.sent_at)}` : ", not sent yet"}. Not approved yet.`
      : "No approval link yet.";
  const feeLine = feeNotice(settings.inspection_fee_notice, job.inspection_fee_aed ?? settings.inspection_fee_aed);

  const isVideo = (k: string) => k === "video" || k === "video_exterior" || k === "video_interior";
  const wanted = media
    .filter((m) => !isVideo(m.kind))
    .map((m) => ({
      url: mediaUrls.get(m.storage_path) ?? "",
      label: [MEDIA_KIND_LABELS[m.kind], isWheelKind(m.kind) && m.wheel_condition?.length ? wheelConditionText(m.wheel_condition) : null, m.caption].filter(Boolean).join(" · "),
    }))
    .filter((p) => p.url);
  if (card.vehiclePhotoUrl) wanted.unshift({ url: card.vehiclePhotoUrl, label: "Car picture" });
  // Each picture is fetched here, so one missing or broken file is simply left out instead of killing the PDF.
  const photos = (
    await Promise.all(
      wanted.slice(0, 36).map(async (p) => {
        try {
          const r = await fetch(p.url);
          if (!r.ok) return null;
          const data = Buffer.from(await r.arrayBuffer());
          if (!data.length) return null;
          const format: "jpg" | "png" = data[0] === 0x89 && data[1] === 0x50 ? "png" : "jpg";
          return { data, format, label: p.label };
        } catch {
          return null;
        }
      })
    )
  ).filter((p): p is NonNullable<typeof p> => !!p);

  const gateOutRows: [string, string][] | null = gateOut
    ? ([
        ["Gated out", `${job.gated_out_at ? formatDateTime(job.gated_out_at) : ""} by ${card.gatedOutBy ?? "unknown"}`],
        ["Old parts", gateOut.old_parts_handed == null ? "" : gateOut.old_parts_handed ? "Handed over" : "Not handed"],
        ["Keys returned", `${gateOut.keys_returned}, ${gateOut.keychain_returned ? "with keychain" : "no keychain"}${gateOut.keys_match ? "" : " (did not match gate-in)"}`],
        ...(gateOut.keys_override_reason ? ([["Keys override", gateOut.keys_override_reason]] as [string, string][]) : []),
        ["Dash cam reconnected", gateOut.dash_cam_reconnected == null ? "Not fitted" : gateOut.dash_cam_reconnected ? "Yes" : "No"],
        ...(gateOut.notes ? ([["Gate-out notes", gateOut.notes]] as [string, string][]) : []),
      ].filter(([, v]) => v !== "") as [string, string][])
    : null;

  const pdf = await renderGateInPdf({
    jobNumber: job.job_number,
    plate: formatPlate(vehicle),
    car: vehicleTitle(vehicle),
    vin: vehicle.vin,
    colour: vehicle.colour,
    customerName: customerPublic?.company_name ?? customerPublic?.full_name ?? "Customer",
    // The phone and customer number print only for roles that may see customer details on screen.
    customerPhone: can(staff.role_id as RoleId, "viewCustomers") ? (card.customer?.phone ?? null) : null,
    customerNumber: can(staff.role_id as RoleId, "viewCustomers") ? (card.customer?.customer_number ?? null) : null,
    gatedIn: formatDateTime(job.gated_in_at),
    gatedInBy: card.gatedInBy ?? "unknown",
    details,
    requests: requests.map((r) => r.text),
    approval,
    feeLine,
    gateOut: gateOutRows,
    photos,
    videoCount: media.filter((m) => isVideo(m.kind)).length,
    printedBy: staff.display_name,
    printedAt: formatDateTime(new Date().toISOString()),
  });
  return pdfResponse(pdf, `OFJ Gate-in ${job.job_number}.pdf`);
}
