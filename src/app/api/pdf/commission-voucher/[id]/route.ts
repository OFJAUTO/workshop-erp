import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { renderCommissionVoucherPdf } from "@/lib/pdf/commission-voucher-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The commission payment voucher to print and sign: accounts and the owner only. Internal. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) return new NextResponse("Please sign in.", { status: 401 });
  if (!(staff.role_id === "owner" || staff.role_id === "accounts")) return new NextResponse("Not allowed.", { status: 403 });
  const { id } = await context.params;
  const admin = createAdminClient();
  const { data: pay } = await admin.from("commission_payments").select("id, number, recipient, recipient_phone, method, paid_on, amount_aed, reference, note, paid_by").eq("id", id).maybeSingle();
  if (!pay) return new NextResponse("Not found.", { status: 404 });
  const [{ data: covers }, { data: payer }, settings] = await Promise.all([
    admin.from("quotations").select("number, version, commission_aed, job:jobs!quotations_job_id_fkey(job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), invoices:invoices!invoices_job_id_fkey(number, kind, status))").eq("commission_payment_id", id).eq("is_active", true),
    admin.from("staff").select("display_name").eq("id", pay.paid_by).maybeSingle(),
    getSettings(),
  ]);
  type Cover = { number: string; version: number; commission_aed: number | string | null; job: { job_number: string; vehicle: Parameters<typeof formatPlate>[0] & { variant?: string | null; model_year?: number | null; make?: { name: string } | null; model?: { name: string } | null }; invoices: { number: string; kind: string; status: string }[] } | null };
  const pdf = await renderCommissionVoucherPdf(
    {
      number: pay.number,
      paidOn: formatDate(`${pay.paid_on}T12:00:00+04:00`),
      recipient: pay.recipient,
      recipientPhone: pay.recipient_phone,
      amount: Number(pay.amount_aed) || 0,
      method: pay.method as "cash" | "transfer",
      reference: pay.reference,
      note: pay.note,
      paidByName: payer?.display_name ?? "Accounts",
      covers: (((covers ?? []) as unknown as Cover[]) ?? []).map((c) => ({
        quotation: `${c.number} v${c.version}`,
        job: c.job?.job_number ?? "",
        plate: c.job?.vehicle ? formatPlate(c.job.vehicle) : "",
        car: [c.job?.vehicle?.make?.name, c.job?.vehicle?.model?.name, c.job?.vehicle?.model_year].filter(Boolean).join(" "),
        invoice: c.job?.invoices?.find((i) => i.kind === "tax_invoice" && i.status === "issued")?.number ?? null,
        amount: Number(c.commission_aed) || 0,
      })),
    },
    settings
  );
  return pdfResponse(pdf, `OFJ Commission voucher ${pay.number}.pdf`);
}
