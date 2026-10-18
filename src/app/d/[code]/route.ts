import { NextResponse } from "next/server";
import { urlOfCode } from "@/lib/short-links";

/** The driver's short link: straight to his one-button page. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const url = await urlOfCode(code);
  return NextResponse.redirect(url ?? new URL("/", req.url), 302);
}
