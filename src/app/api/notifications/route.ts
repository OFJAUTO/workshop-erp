import { dbWords } from "@/lib/app-errors";
import { NextResponse, after, type NextRequest } from "next/server";
import { checkLateJobs } from "@/lib/background-jobs";
import { getCurrentStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ACTION_RULES, isActionType } from "@/lib/bell-rules";
import { bellColumnsReady, clearDoneNoticesSoon } from "@/lib/bell-clear";

/** The bell shows the person on screen: the owner's own login, or whoever the owner is viewing or acting as in this tab. */
async function clientFor(staff: { viewingAs: unknown; actingAs: unknown }) {
  return staff.viewingAs || staff.actingAs ? createAdminClient() : await createClient();
}

const ACTION_TYPES = Object.keys(ACTION_RULES);

/**
 * The current person's latest notifications and the badge count. The badge counts OPEN ACTIONS only (9 November 2026):
 * an unread notice of an action type; information notices never count. Archived notices (30 days after being read or
 * cleared) are left out.
 */
export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // Every signed-in screen polls here, so a background job that stopped is noticed even when both jobs stopped
  // (at most once a minute per server, after the answer has gone). Done tasks clear their notices the same way.
  after(() => checkLateJobs().catch(() => null));
  after(() => clearDoneNoticesSoon());
  const supabase = await clientFor(staff);
  const archived = await bellColumnsReady();
  let list = supabase.from("notifications").select("id, type, title, body, job_id, href, read_at, created_at").eq("staff_id", staff.id);
  let count = supabase.from("notifications").select("id", { count: "exact", head: true }).eq("staff_id", staff.id).is("read_at", null).in("type", ACTION_TYPES);
  if (archived) {
    list = list.is("archived_at", null);
    count = count.is("archived_at", null);
  }
  const [{ data: items }, { count: unread }] = await Promise.all([list.order("created_at", { ascending: false }).limit(30), count]);
  const out = ((items ?? []) as { type: string }[]).map((i) => ({ ...i, action: isActionType(i.type) }));
  return NextResponse.json({ items: out, unread: unread ?? 0, staffId: staff.id });
}

/** Marks notifications read: { ids: number[] }, { all: true }, or { seen: number[] } = information notices the panel showed. */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { ids?: number[]; all?: boolean; seen?: number[] };
  const supabase = await clientFor(staff);
  let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("staff_id", staff.id).is("read_at", null);
  if (body.seen) {
    // Information only: an action notice stays open until it is opened or its task is done.
    const ids = body.seen.filter((n) => Number.isInteger(n));
    if (ids.length === 0) return NextResponse.json({ ok: true });
    q = q.in("id", ids).not("type", "in", `(${ACTION_TYPES.join(",")})`);
  } else if (!body.all) {
    const ids = (body.ids ?? []).filter((n) => Number.isInteger(n));
    if (ids.length === 0) return NextResponse.json({ ok: true });
    q = q.in("id", ids);
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: dbWords(error, "api/notifications") }, { status: 500 });
  return NextResponse.json({ ok: true });
}
