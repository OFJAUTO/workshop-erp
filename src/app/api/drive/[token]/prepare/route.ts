import { NextResponse, type NextRequest } from "next/server";
import { prepareTripPhoto, tripByToken } from "@/lib/delivery";

export const dynamic = "force-dynamic";

/** A signed address for the driver's photo, straight to storage (30 October 2026). Only for an open trip of this link. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = (await request.json().catch(() => null)) as { step?: string; contentType?: string } | null;
  const step = body?.step === "loaded" ? "loaded" : "final";
  const contentType = String(body?.contentType ?? "image/jpeg");
  if (!contentType.startsWith("image/")) return NextResponse.json({ error: "Only a photo is sent here.", code: "photo" }, { status: 400 });
  const trip = await tripByToken(token);
  if (!trip) return NextResponse.json({ error: "This link is no longer valid.", code: "link" }, { status: 410 });
  if (trip.delivered_at) return NextResponse.json({ error: "Already done, thank you.", code: "done" }, { status: 409 });
  const r = await prepareTripPhoto(trip.id, step, contentType);
  if ("error" in r) return NextResponse.json(r, { status: 500 });
  return NextResponse.json(r);
}
