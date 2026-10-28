import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { positionsWords } from "@/lib/parts-list";
import { renderPartsCheckPdf, type CheckRow } from "@/lib/pdf/parts-check-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The internal parts price check on paper: Parts, advisors and the owner only. Never for a customer. */
export async function GET(_request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) return new NextResponse("Please sign in.", { status: 401 });
  if (!["owner", "service_advisor", "parts"].includes(staff.role_id)) return new NextResponse("Not allowed.", { status: 403 });
  const { jobId } = await context.params;
  const admin = createAdminClient();
  const [{ data: job }, { data: partRows }, { data: reqRows }] = await Promise.all([
    admin.from("jobs").select("id, job_number, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", jobId).maybeSingle(),
    admin.from("part_items").select("description, original_description, part_number, part_type, quantity, confirmed_quantity, list_price_aed, discount_percent, cost_aed, supplier, availability, delivery_date, expected_date, order_status, removed_at, return_status, not_needed_at, disposition, part_request_id, availability_note, positions, created_at").eq("job_id", jobId).eq("is_active", true).order("created_at"),
    admin.from("part_requests").select("id, note, positions").eq("job_id", jobId),
  ]);
  if (!job) return new NextResponse("Not found.", { status: 404 });
  type V = { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };
  const v = job.vehicle as unknown as V | null;
  const reqOf = new Map((reqRows ?? []).map((r) => [r.id as string, r]));
  const all = (partRows ?? []) as Record<string, unknown>[];
  const counted = all.filter((p) => !p.removed_at && p.return_status !== "returned" && !(p.not_needed_at && p.disposition !== "fit_approved"));
  const availWords = (p: Record<string, unknown>) => {
    const due = (p.expected_date ?? p.delivery_date) as string | null;
    if (p.order_status === "received" || p.availability === "in_stock") return p.availability === "in_stock" ? "In stock" : "Received";
    if (p.order_status === "ordered" || p.order_status === "partly_received") return due ? `Ordered, by ${formatDate(due)}` : "Ordered";
    return due ? `By ${formatDate(due)}` : "To order";
  };
  const rows: CheckRow[] = counted.map((p) => {
    const req = p.part_request_id ? reqOf.get(p.part_request_id as string) : null;
    // The part's own positions, else its request's (an empty list on the part must not hide the request's).
    const own = (p.positions ?? []) as string[];
    const positions = own.length ? own : (((req?.positions ?? []) as string[]) ?? []);
    const note = [
      (req?.note as string | null) ?? "",
      p.original_description && p.original_description !== p.description ? `Technician wrote: ${p.original_description}` : "",
      (p.availability_note as string | null) ?? "",
    ].filter(Boolean).join(" · ");
    return {
      description: String(p.description ?? ""),
      positions: positionsWords(positions) || null,
      note: note || null,
      part_number: (p.part_number as string | null) || null,
      part_type: (p.part_type as string | null) || null,
      qty: Number(p.confirmed_quantity ?? p.quantity) || 1,
      list: p.list_price_aed === null || p.list_price_aed === undefined ? null : Number(p.list_price_aed),
      discount: Number(p.discount_percent) || null,
      net: Number(p.cost_aed) || 0,
      supplier: String(p.supplier ?? "").trim(),
      availability: availWords(p),
    };
  });
  const pdf = await renderPartsCheckPdf({
    jobNumber: job.job_number as string,
    plate: v ? formatPlate(v) : (job.job_number as string),
    car: [v?.make?.name, v?.model?.name, v?.variant, v?.model_year].filter(Boolean).join(" "),
    vin: v?.vin ?? null,
    printedBy: staff.display_name,
    printedAt: formatDateTime(new Date().toISOString()),
    rows,
    leftOut: all.length - counted.length,
  });
  return pdfResponse(pdf, `OFJ Parts check ${job.job_number}.pdf`);
}
