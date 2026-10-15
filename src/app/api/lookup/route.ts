import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { findCustomerByPhone, findVehicle } from "@/lib/customer-car";

/**
 * Duplicate checks while typing: ?phone=… names the customer already on that number; ?vin=… or
 * ?plate_country=…&plate_emirate=…&plate_code=…&plate_number=… names the car already on record. Staff only.
 */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const p = request.nextUrl.searchParams;
  const phone = p.get("phone");
  const vin = p.get("vin");
  const number = p.get("plate_number");
  const [customer, vehicle] = await Promise.all([
    phone ? findCustomerByPhone(phone) : Promise.resolve(null),
    vin || number ? findVehicle({ vin: vin ?? null, plate: number ? { country: p.get("plate_country") || "UAE", emirate: p.get("plate_emirate") || null, code: p.get("plate_code") || null, number } : null }) : Promise.resolve(null),
  ]);
  return NextResponse.json({ customer, vehicle });
}
