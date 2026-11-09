import { NextResponse, type NextRequest } from "next/server";
import { loadStatement } from "@/lib/customer-statement";
import { renderStatementPdf } from "@/lib/pdf/statement-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";
import { readStatement } from "@/lib/statement-token";

export const dynamic = "force-dynamic";

/** The customer's statement or combined bill as a PDF, from its signed link (9 November 2026): always today's figures. */
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const g = readStatement(token);
  if (!g) return new NextResponse("This link is not valid any more. Ask OFJ for a new one.", { status: 404 });
  const st = await loadStatement(g.c, { docIds: g.k === "combined" ? (g.d ?? []) : undefined, withLines: g.k === "combined" });
  if (!st) return new NextResponse("Not found.", { status: 404 });
  return pdfResponse(await renderStatementPdf(st, await getSettings(), g.k), `OFJ ${g.k === "combined" ? "Combined proforma" : "Statement"}.pdf`);
}
