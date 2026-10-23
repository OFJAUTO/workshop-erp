import { NextResponse, type NextRequest } from "next/server";
import { reportVideosByToken } from "@/lib/report-videos";

export const dynamic = "force-dynamic";

/**
 * Fresh, short-lived addresses for the inspection videos on a customer's report link (23 October 2026): the player
 * asks when Play is tapped on a page left open for a while, so a video stays viewable as long as the link works.
 * Only the report link's token opens it.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t") ?? "";
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const videos = await reportVideosByToken(token);
  if (!videos) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ videos, signedAt: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
