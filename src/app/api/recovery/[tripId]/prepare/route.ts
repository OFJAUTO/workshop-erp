import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { prepareTripPhoto } from "@/lib/delivery";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The office's photo for a trip the driver could not finish (30 October 2026): a signed address straight to storage. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || !can(staff.role_id as RoleId, "gateOut")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const { tripId } = await params;
  const body = (await request.json().catch(() => null)) as { contentType?: string } | null;
  const contentType = String(body?.contentType ?? "image/jpeg");
  if (!contentType.startsWith("image/")) return NextResponse.json({ error: "Only a photo is sent here." }, { status: 400 });
  const { data: trip } = await createAdminClient().from("recovery_trips").select("id, delivered_at, is_active").eq("id", tripId).maybeSingle();
  if (!trip || !trip.is_active) return NextResponse.json({ error: "Trip not found." }, { status: 404 });
  if (trip.delivered_at) return NextResponse.json({ error: "This trip is already done." }, { status: 409 });
  const r = await prepareTripPhoto(tripId, "office", contentType);
  if ("error" in r) return NextResponse.json(r, { status: 500 });
  return NextResponse.json(r);
}
