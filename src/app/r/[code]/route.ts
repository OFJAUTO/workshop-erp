import { NextResponse } from "next/server";
import { urlOfCode } from "@/lib/short-links";

/** A short receipt link (erp.ofjauto.com/r/xxxx). */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const url = await urlOfCode(code);
  return NextResponse.redirect(url ?? new URL("/", req.url), 302);
}
