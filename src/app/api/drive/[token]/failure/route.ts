import { NextResponse, type NextRequest } from "next/server";
import { tripByToken } from "@/lib/delivery";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * A driver's photo that could not be sent yet, written to the upload log the owner reads (Settings > Uploads) with
 * the reason: no internet, the signal dropping, the server, an expired link (30 October 2026). Each reason once per
 * photo (the page keeps count); at most 40 a trip an hour. Never fails the page.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = (await request.json().catch(() => null)) as { step?: string; reason?: string; error?: string; status?: number | null; sizeBytes?: number | null; contentType?: string | null; attempts?: number; online?: boolean | null; itemId?: string } | null;
  if (!body) return NextResponse.json({ ok: false }, { status: 400 });
  const trip = await tripByToken(token);
  if (!trip) return NextResponse.json({ ok: false }, { status: 410 });
  const admin = createAdminClient();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("upload_failures").select("id", { count: "exact", head: true }).eq("kind", "recovery_photo").gte("created_at", since).contains("extra", { trip_id: trip.id });
  if ((count ?? 0) >= 40) return NextResponse.json({ ok: true, capped: true });
  await admin.from("upload_failures").insert({
    job_id: trip.job_id,
    kind: "recovery_photo",
    step: String(body.step ?? "upload").slice(0, 40),
    error: `${String(body.reason ?? "unknown").slice(0, 40)}: ${String(body.error ?? "").slice(0, 400)}`,
    via: "driver_link",
    user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300),
    size_bytes: typeof body.sizeBytes === "number" ? Math.round(body.sizeBytes) : null,
    content_type: body.contentType ? String(body.contentType).slice(0, 60) : null,
    extra: { trip_id: trip.id, driver: trip.driver_name, status: body.status ?? null, attempts: body.attempts ?? null, online: body.online ?? null, item: body.itemId ?? null },
  });
  return NextResponse.json({ ok: true });
}
