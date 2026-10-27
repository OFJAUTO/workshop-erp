import { NextResponse, type NextRequest } from "next/server";
import { ZOHO_REAL_ORG_ID, ZohoError, zohoFetch } from "@/lib/zoho";
import { beforeGoLiveStart, readZohoMap, reopenZoho, zohoWriteOrg, type ZohoKind } from "@/lib/zoho-sync";
import { goLiveChecklist, reconGate, startDateGate } from "@/lib/zoho-golive";
import { reconDue, reconOrgFor } from "@/lib/zoho-reconcile";
import { validMonth } from "@/lib/zoho-close";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Local test hooks for the Zoho sync (never in production). The important one is the write-guard proof: a write
 * aimed at the REAL organization must be REFUSED by zohoFetch itself, before any token or network work — so this
 * runs on a dev machine with no Zoho secret at all.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || !process.env.E2E_SECRET || request.headers.get("x-e2e-secret") !== process.env.E2E_SECRET) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action === "write_to_real") {
    // The probe only makes sense while the real book is read-only: with the go-live switch ON it would be a
    // genuine write attempt (and on a dev machine would smear last_error on the live token row) — refused.
    const settings = await getSettings();
    if (settings.zoho_live_enabled === true) {
      return NextResponse.json({ refused: false, error: "The go-live switch is ON: this probe only runs while the real book is read-only." }, { status: 409 });
    }
    // The guard test: this must throw the refusal, never reach Zoho.
    try {
      await zohoFetch("/contacts", { org: ZOHO_REAL_ORG_ID, method: "POST", body: { contact_name: "E2e guard probe" } });
      return NextResponse.json({ refused: false, error: "THE WRITE WENT THROUGH - the guard is broken." }, { status: 500 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ refused: e instanceof ZohoError && /read-only until the owner declares go-live/.test(msg), message: msg });
    }
  }
  if (body.action === "write_org") {
    const [org, settings] = await Promise.all([zohoWriteOrg(), getSettings()]);
    return NextResponse.json({ org, live: settings.zoho_live_enabled === true, map: readZohoMap(settings) });
  }
  if (body.action === "golive_checklist") {
    // The evaluated gates, without any flip: proves the switch blocks while anything is red.
    const checklist = await goLiveChecklist({ checkReal: false });
    return NextResponse.json(checklist);
  }
  if (body.action === "date_gate") {
    // The PURE start-date rule, with injected values: the flip itself is never simulated against REAL.
    const cases = (body as { cases?: { docDate: string; live: boolean; startDate: string }[] }).cases ?? [];
    return NextResponse.json({ results: cases.map((c) => beforeGoLiveStart(c.docDate, c.live, c.startDate)) });
  }
  if (body.action === "reopen") {
    // The hook a late file upload calls: a row closed by hand must turn red, never re-post.
    const b = body as { kind?: ZohoKind; recordId?: string };
    if (!b.kind || !b.recordId) return NextResponse.json({ error: "kind and recordId" }, { status: 400 });
    await reopenZoho(b.kind, b.recordId);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "pure_rules") {
    // The review round's pure rules, with injected values (no Zoho, no flip).
    const b = body as {
      reconGate?: { rows: { day: string; status: string; checked_at: string }[]; today: string }[];
      startGate?: { start: string; today: string }[];
      reconOrg?: { day: string; live: boolean; start: string; testOrg: string | null }[];
      reconDue?: { row: { status: string; checked_at: string } | null; day: string; nowMs: number; saturated: boolean }[];
      months?: string[];
    };
    return NextResponse.json({
      reconGate: (b.reconGate ?? []).map((c) => reconGate(c.rows, c.today)),
      startGate: (b.startGate ?? []).map((c) => startDateGate(c.start, c.today)),
      reconOrg: (b.reconOrg ?? []).map((c) => reconOrgFor(c.day, c.live, c.start, c.testOrg)),
      reconDue: (b.reconDue ?? []).map((c) => reconDue(c.row, c.day, c.nowMs, c.saturated)),
      months: (b.months ?? []).map((m) => validMonth(m)),
    });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
