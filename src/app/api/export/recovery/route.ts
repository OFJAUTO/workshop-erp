import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { TRIP_SELECT, type TripRow } from "@/lib/delivery";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceHistoryOf } from "@/lib/recovery";
import { formatPlate } from "@/lib/types";
import { buildXlsx, xlsxResponse, type XlsxSheet } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

const COLUMNS = [
  { header: "Date", key: "date", width: 12 },
  { header: "Pick-up/Delivery", key: "kind", width: 16 },
  { header: "Plate", key: "plate", width: 16 },
  { header: "Job number", key: "job", width: 12 },
  { header: "Driver/company", key: "who", width: 24 },
  { header: "From", key: "from", width: 28 },
  { header: "To", key: "to", width: 28 },
  { header: "Road km", key: "km", width: 10, numFmt: "0.0" },
  { header: "Price (AED)", key: "price", width: 12, numFmt: "#,##0.00" },
  { header: "Claimed (AED)", key: "claimed", width: 13, numFmt: "#,##0.00" },
  { header: "Price change", key: "change", width: 34 },
  { header: "AED per km", key: "perKm", width: 11, numFmt: "0.0" },
  { header: "Status", key: "status", width: 12 },
];

/** The month's recovery trips as a real Excel file; ?who=all gives one sheet per driver or company plus a summary. */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "accounts"].includes(staff.role_id)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const month = request.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "Bad month." }, { status: 400 });
  const who = request.nextUrl.searchParams.get("who");
  const admin = createAdminClient();
  const { data: rows } = await admin.from("recovery_trips").select(TRIP_SELECT).eq("is_active", true).gte("created_at", `${month}-01`).order("created_at");
  const trips = ((rows ?? []) as TripRow[]).filter((t) => (t.delivered_at ?? t.created_at).startsWith(month));
  const jobIds = Array.from(new Set(trips.map((t) => t.job_id).filter((x): x is string => !!x)));
  const { data: jobs } = jobIds.length ? await admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number)").in("id", jobIds) : { data: [] };
  const jobOf = new Map((jobs ?? []).map((j) => [j.id, { number: j.job_number as string, plate: j.vehicle ? formatPlate(j.vehicle as unknown as Parameters<typeof formatPlate>[0]) : "" }]));
  const whoOf = (t: TripRow) => t.company ?? (t.driver_name ? `Our truck · ${t.driver_name}` : "Our truck");
  const rowOf = (t: TripRow) => {
    const j = t.job_id ? jobOf.get(t.job_id) : null;
    const km = t.road_km !== null ? Number(t.road_km) : null;
    const price = t.price_aed === null ? null : Number(t.price_aed);
    const place = t.location_details ?? t.location_url ?? "";
    return {
      date: new Date((t.delivered_at ?? t.created_at).slice(0, 10) + "T12:00:00Z"),
      kind: t.kind === "pickup" ? "Pick-up" : "Delivery",
      plate: j?.plate ?? "",
      job: j?.number ?? "",
      who: whoOf(t),
      from: t.kind === "pickup" ? place : "OFJ Automotive",
      to: t.kind === "pickup" ? "OFJ Automotive" : place,
      km,
      price,
      // The final price is the one to pay; the driver's own claim and the reason show when it was changed.
      claimed: t.original_price_aed !== null && t.original_price_aed !== undefined ? Number(t.original_price_aed) : null,
      change: priceHistoryOf(t.price_history).map((c) => `${c.from} → ${c.to}: ${c.reason}`).join("; "),
      perKm: km && price ? Math.round((price / km) * 10) / 10 : null,
      status: t.status,
    };
  };
  const totalsOf = (list: TripRow[]) => ({
    date: `${list.length} trips`,
    km: list.reduce((a, t) => a + (t.road_km !== null ? Number(t.road_km) : 0), 0),
    who: "TOTAL TO PAY",
    price: list.reduce((a, t) => a + (Number(t.price_aed) || 0), 0),
  });
  const sheets: XlsxSheet[] = [];
  if (who === "all") {
    const names = Array.from(new Set(trips.map(whoOf))).sort();
    sheets.push({
      name: "Summary",
      columns: [
        { header: "Driver/company", key: "who", width: 26 },
        { header: "Trips", key: "trips", width: 8 },
        { header: "Road km", key: "km", width: 10, numFmt: "0.0" },
        { header: "Total (AED)", key: "total", width: 14, numFmt: "#,##0.00" },
      ],
      rows: names.map((n) => {
        const list = trips.filter((t) => whoOf(t) === n);
        return { who: n, trips: list.length, km: list.reduce((a, t) => a + (t.road_km !== null ? Number(t.road_km) : 0), 0), total: list.reduce((a, t) => a + (Number(t.price_aed) || 0), 0) };
      }),
      totals: { who: "TOTAL TO PAY", trips: trips.length, km: trips.reduce((a, t) => a + (t.road_km !== null ? Number(t.road_km) : 0), 0), total: trips.reduce((a, t) => a + (Number(t.price_aed) || 0), 0) },
    });
    for (const n of names) {
      const list = trips.filter((t) => whoOf(t) === n);
      sheets.push({ name: n.replace(/[\\/*?[\]:]/g, " ").slice(0, 31), columns: COLUMNS, rows: list.map(rowOf), totals: totalsOf(list) });
    }
  } else {
    const list = who ? trips.filter((t) => whoOf(t) === who) : trips;
    sheets.push({ name: `Recovery ${month}`, columns: COLUMNS, rows: list.map(rowOf), totals: totalsOf(list) });
  }
  return xlsxResponse(await buildXlsx(sheets), `OFJ recovery ${month}${who === "all" ? " by driver" : ""}.xlsx`);
}
