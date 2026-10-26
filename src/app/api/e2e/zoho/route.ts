import { NextResponse, type NextRequest } from "next/server";
import { ZOHO_REAL_ORG_ID, ZohoError, zohoFetch } from "@/lib/zoho";
import { readZohoMap, zohoWriteOrg } from "@/lib/zoho-sync";
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
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
