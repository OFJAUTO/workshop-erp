import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { TRIP_SELECT, type TripRow } from "@/lib/delivery";
import { haversineKm, parseCoords } from "@/lib/recovery";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The month's recovery trips as a CSV for accounts. */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "accounts", "service_advisor"].includes(staff.role_id)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const month = request.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "Bad month." }, { status: 400 });
  const admin = createAdminClient();
  const settings = await getSettings();
  const home = parseCoords(String(settings.workshop_location_pin ?? ""));
  const { data: rows } = await admin.from("recovery_trips").select(TRIP_SELECT).eq("is_active", true).gte("created_at", `${month}-01`).lt("created_at", `${month}-31T23:59:59Z`).order("created_at");
  const trips = ((rows ?? []) as TripRow[]).filter((t) => (t.delivered_at ?? t.created_at).startsWith(month));
  const jobIds = Array.from(new Set(trips.map((t) => t.job_id).filter((x): x is string => !!x)));
  const { data: jobs } = jobIds.length ? await admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number)").in("id", jobIds) : { data: [] };
  const jobOf = new Map((jobs ?? []).map((j) => [j.id, { number: j.job_number as string, plate: j.vehicle ? formatPlate(j.vehicle as unknown as Parameters<typeof formatPlate>[0]) : "" }]));
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const lines = [["Date", "Kind", "Plate", "Job", "Driver or company", "Location", "Distance km", "Price AED", "Status"].join(",")];
  for (const t of trips) {
    const j = t.job_id ? jobOf.get(t.job_id) : null;
    const km = home && t.lat !== null && t.lng !== null ? haversineKm(home, { lat: t.lat, lng: t.lng }) : "";
    lines.push([
      esc((t.delivered_at ?? t.created_at).slice(0, 10)), esc(t.kind), esc(j?.plate ?? ""), esc(j?.number ?? ""),
      esc(t.company ?? `Our truck${t.driver_name ? ` · ${t.driver_name}` : ""}`), esc(t.location_details ?? t.location_url ?? ""),
      esc(km), esc(t.price_aed ?? ""), esc(t.status),
    ].join(","));
  }
  return new NextResponse(lines.join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="recovery-${month}.csv"` } });
}
