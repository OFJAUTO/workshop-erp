import { NextResponse, type NextRequest } from "next/server";
import { loadHandover } from "@/lib/bodyshop-public";
import { pdfResponse } from "@/lib/pdf/response";
import { renderWarrantyPdf } from "@/lib/pdf/warranty-pdf";
import { getSettings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

/** The PPF warranty certificate from the handover token. Cars without PPF have no certificate. */
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const settings = await getSettings();
  const data = await loadHandover(token, settings);
  if (!data) return new NextResponse("This link is not valid.", { status: 404 });
  if (!data.warranty) return new NextResponse("No PPF warranty on this job.", { status: 404 });
  const pdf = await renderWarrantyPdf(
    {
      customerName: data.customer?.company_name ?? data.customer?.full_name ?? "Customer",
      car: data.carTitle,
      plate: data.plate,
      vin: data.job.vehicle?.vin ?? null,
      film: data.filmText,
      installDate: data.warranty.installDate,
      validUntil: data.warranty.validUntil,
      certificateNo: data.warranty.certificateNo,
      verifyUrl: `${PRODUCTION_SITE_URL}/handover/${token}`,
    },
    settings,
  );
  return pdfResponse(pdf, `OFJ PPF warranty ${data.warranty.certificateNo}.pdf`);
}
