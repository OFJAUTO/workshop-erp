import { NextResponse, type NextRequest } from "next/server";
import {
  ZOHO_REAL_ORG_ID,
  listAccounts,
  listBankAccounts,
  listOrganizations,
  listPaymentModes,
  listTaxes,
  mirrorRealIntoTest,
  zohoConnection,
  zohoTestOrgId,
} from "@/lib/zoho";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Support inspection (26 October 2026), protected by CRON_SECRET like the cron routes: the read-only listing of
 * the REAL and TEST organizations (taxes, chart of accounts, bank accounts, payment modes), and `?mirror=1` runs
 * the OFJ TEST mirror first. Writes can only reach the TEST organization — the zohoFetch guard refuses REAL.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    const conn = await zohoConnection();
    if (!conn) return NextResponse.json({ ok: false, error: "Zoho Books is not connected yet." }, { status: 503 });
    const testOrg = await zohoTestOrgId();
    const mirror = request.nextUrl.searchParams.get("mirror") === "1" ? await mirrorRealIntoTest() : null;
    const read = async (org: string) => ({
      taxes: (await listTaxes(org)).map((t) => ({ name: t.tax_name, percent: Number(t.tax_percentage) })),
      accounts: (await listAccounts(org)).filter((a) => a.is_active !== false).map((a) => ({ name: a.account_name, type: a.account_type })),
      banks: (await listBankAccounts(org).catch(() => [])).map((b) => ({ name: b.account_name, type: b.account_type })),
      paymentModes: await listPaymentModes(org),
    });
    const orgs = (await listOrganizations()).map((o) => ({ id: String(o.organization_id), name: o.name, country: o.country ?? null, currency: o.currency_code ?? null }));
    const real = await read(ZOHO_REAL_ORG_ID);
    const test = testOrg ? await read(testOrg) : null;
    return NextResponse.json({ ok: true, connectedBy: conn.connected_by_name, orgs, realOrg: ZOHO_REAL_ORG_ID, testOrg, real, test, mirror }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
