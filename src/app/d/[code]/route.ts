import { shortLinkResponse } from "@/lib/short-preview";

/** A short link from a WhatsApp message: HTTP 200 with the og preview tags, then on to the stored address. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  return shortLinkResponse(code, "d", req.url);
}

export { GET as HEAD };
