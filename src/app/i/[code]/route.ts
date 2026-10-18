import { NextResponse } from "next/server";
import { urlOfCode } from "@/lib/short-links";

/** A short invoice or proforma link (erp.ofjauto.com/i/xxxx). */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const url = await urlOfCode(code);
  return NextResponse.redirect(url ?? new URL("/", req.url), 302);
}
