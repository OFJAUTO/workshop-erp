import { NextResponse } from "next/server";
import { urlOfCode } from "@/lib/short-links";

/** A short link from a WhatsApp message (a map pin, a quotation, an invoice): straight to the stored address. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const url = await urlOfCode(code);
  return NextResponse.redirect(url ?? new URL("/", req.url), 302);
}
