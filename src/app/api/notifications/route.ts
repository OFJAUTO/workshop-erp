import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** The current person's latest notifications and unread count. */
export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const supabase = await createClient();
  const [{ data: items }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, type, title, body, job_id, href, read_at, created_at")
      .eq("staff_id", staff.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("staff_id", staff.id).is("read_at", null),
  ]);
  return NextResponse.json({ items: items ?? [], unread: count ?? 0, staffId: staff.id });
}

/** Marks notifications read: { ids: number[] } or { all: true }. */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { ids?: number[]; all?: boolean };
  const supabase = await createClient();
  let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("staff_id", staff.id).is("read_at", null);
  if (!body.all) {
    const ids = (body.ids ?? []).filter((n) => Number.isInteger(n));
    if (ids.length === 0) return NextResponse.json({ ok: true });
    q = q.in("id", ids);
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
