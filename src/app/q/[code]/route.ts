import { NextResponse } from "next/server";
import { urlOfCode } from "@/lib/short-links";

/** A short quotation link (erp.ofjauto.com/q/xxxx): straight to the customer's quotation. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const url = await urlOfCode(code);
  return NextResponse.redirect(url ?? new URL("/", req.url), 302);
}
