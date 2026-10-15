import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { compactPartNumber } from "@/lib/price-import";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Price memory: the last price given for a part number ("A 167 330 68 00" and "A1673306800" are the same number):
 * list, discount, net, supplier, type and when. Staff only.
 */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const pn = request.nextUrl.searchParams.get("pn") ?? "";
  const compact = compactPartNumber(pn);
  if (compact.length < 4) return NextResponse.json({ memory: null });
  const admin = createAdminClient();
  const { data } = await admin.from("part_items").select("part_number, list_price_aed, discount_percent, cost_aed, supplier, part_type, brand, priced_at, job:jobs!part_items_job_id_fkey(job_number)").eq("is_active", true).not("priced_at", "is", null).not("cost_aed", "is", null).not("part_number", "is", null).order("priced_at", { ascending: false }).limit(400);
  const hit = ((data ?? []) as unknown as { part_number: string | null; list_price_aed: number | string | null; discount_percent: number | string | null; cost_aed: number | string | null; supplier: string | null; part_type: string | null; brand: string | null; priced_at: string | null; job: { job_number: string } | null }[]).find((r) => compactPartNumber(r.part_number) === compact);
  if (!hit) return NextResponse.json({ memory: null });
  return NextResponse.json({
    memory: {
      list_price: hit.list_price_aed === null ? null : Number(hit.list_price_aed),
      discount: hit.discount_percent === null ? null : Number(hit.discount_percent),
      net: hit.cost_aed === null ? null : Number(hit.cost_aed),
      supplier: hit.supplier,
      part_type: hit.part_type,
      brand: hit.brand,
      priced_at: hit.priced_at,
      job_number: hit.job?.job_number ?? null,
    },
  });
}
