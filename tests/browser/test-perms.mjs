// Money permissions (19 October 2026, section 1 + 9): advisors never record payments and never see
// recovery money; the server blocks them even when the button is bypassed. Run with the dev server up:
//   node --env-file=.env.test.local tests/browser/test-perms.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, loginCookies, makeChecks, projectRoot, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();

/* ---------- A. The permission matrix in code (roles.ts has no imports: load it directly) ---------- */
const roles = await import(`file:///${projectRoot.replaceAll("\\", "/")}/src/lib/roles.ts`);
const only = (perm, expected) => check(`A: ${perm} = ${expected.join("+")} only`, JSON.stringify([...roles.PERMISSIONS[perm]].sort()) === JSON.stringify([...expected].sort()), JSON.stringify(roles.PERMISSIONS[perm]));
only("recordPayments", ["owner", "accounts"]);
only("verifyPayments", ["owner", "accounts"]);
only("issueInvoices", ["owner", "accounts"]);
only("approveCreditNotes", ["owner"]);
only("approveRelease", ["owner", "accounts"]);
only("exportAccounts", ["owner", "accounts"]);
check("A: can(service_advisor, recordPayments) is false", !roles.can("service_advisor", "recordPayments"));
check("A: can(accounts, recordPayments) is true", roles.can("accounts", "recordPayments"));
const money = await import(`file:///${projectRoot.replaceAll("\\", "/")}/src/lib/money-steps.ts`);
check("A: methodsFor(advisor) is empty", money.methodsFor("service_advisor").length === 0);
check("A: methodsFor(accounts) has all five", money.methodsFor("accounts").length === 5);

/* ---------- B. The seeded ready job: proforma out, unpaid ---------- */
const seed = await api("/api/e2e/stage", { stage: "ready" });
const jobId = seed.json?.jobId;
check("B: ready stage seeded with a proforma", !!jobId && !!seed.json?.invoice?.id, JSON.stringify(seed.json)?.slice(0, 120));
const invoicePage = `${base}/jobs/${jobId}/invoice`;

/* The advisor: read-only status, no payment form anywhere. */
{
  const { browser, page } = await browserFor("service_advisor");
  await page.goto(invoicePage, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  check("B: advisor sees no Record payment form", (await page.locator("[data-record-block]").count()) === 0);
  // Since the money-page rebuild (21 Oct, 1.3) the advisor's first move on an unsent proforma is Send;
  // the read-only "Waiting for accounts" line takes over once it is sent.
  await sql("update public.invoices set sent_at = now() where id = $1", [seed.json.invoice.id]);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  check("B: advisor sees the read-only waiting line", (await page.locator("[data-waiting-accounts]").count()) === 1, await page.locator("[data-waiting-accounts]").textContent().catch(() => ""));
  const waiting = (await page.locator("[data-waiting-accounts]").textContent().catch(() => "")) ?? "";
  check("B: the line says waiting for accounts", /Waiting for accounts/i.test(waiting), waiting);
  check("B: still no Record payment form after sending", (await page.locator("[data-record-block]").count()) === 0);
  await browser.close();
}

/* Accounts: the form is there. */
{
  const { browser, page } = await browserFor("accounts");
  await page.goto(invoicePage, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  check("B: accounts see the Record payment form", (await page.locator("[data-record-block]").count()) >= 1);
  await browser.close();
}

/* The owner acting as the advisor: permissions follow the advisor. */
{
  const advisorId = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0]?.id;
  const { browser, page, context } = await browserFor("owner");
  const res = await context.request.post(`${base}/api/view-as/set`, { data: { kind: "act", id: advisorId } });
  check("B: acting-as cookie set", res.ok());
  await page.goto(invoicePage, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  check("B: owner acting as advisor sees no Record payment form", (await page.locator("[data-record-block]").count()) === 0);
  await context.request.post(`${base}/api/view-as/set`, { data: { kind: "none" } });
  await browser.close();
}

/* ---------- C. The server: a blocked role calling the endpoints directly ---------- */
/* C1. Supabase REST as the advisor (the browser's own credentials): RLS refuses the insert. */
{
  const cookies = await loginCookies("service_advisor");
  const parts = cookies.filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  let raw = parts.map((c) => decodeURIComponent(c.value)).join("");
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
  const token = JSON.parse(raw).access_token;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const r = await fetch(`${url}/rest/v1/payments`, {
    method: "POST",
    headers: { apikey: anon, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({ job_id: jobId, method: "cash", amount_aed: 100, number: "R-HACK-1", received_by: null }),
  });
  const body = await r.text();
  check("C: REST insert into payments as advisor is refused", r.status === 401 || r.status === 403 || /row-level security/i.test(body), `${r.status} ${body.slice(0, 120)}`);
}

/* C2. The money exports: advisor blocked, bonus export owner only. */
{
  const adv = await cookieHeader("service_advisor");
  const acc = await cookieHeader("accounts");
  const month = new Date().toISOString().slice(0, 7);
  const r1 = await fetch(`${base}/api/export/recovery?month=${month}`, { headers: { cookie: adv } });
  check("C: recovery export as advisor → 403", r1.status === 403, String(r1.status));
  const r2 = await fetch(`${base}/api/export/recovery?month=${month}`, { headers: { cookie: acc } });
  check("C: recovery export as accounts → allowed", r2.status === 200, String(r2.status));
  const r3 = await fetch(`${base}/api/export/bonus?period=${month}`, { headers: { cookie: acc } });
  check("C: bonus export as accounts → 403 (owner only)", r3.status === 403, String(r3.status));
  const r4 = await fetch(`${base}/api/export/accounts?month=${month}`, { headers: { cookie: adv } });
  check("C: accounts export as advisor → 403", r4.status === 403, String(r4.status));
}

/* ---------- D. Recovery money: owner and accounts only (section 9, 19 October) ---------- */
{
  const { browser, page } = await browserFor("service_advisor");
  await page.goto(`${base}/recovery`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const body = (await page.textContent("body")) ?? "";
  check("D: advisor sees no month totals box", (await page.locator("[data-recovery-month]").count()) === 0);
  check("D: advisor sees no trip price", (await page.locator("[data-trip-price]").count()) === 0);
  check("D: advisor sees no km cost", (await page.locator("[data-trip-km]").count()) === 0);
  check("D: advisor sees no Approve / Query / Mark paid", (await page.locator("[data-trip-approve], [data-month-pay], [data-recalc-km]").count()) === 0 && !/Mark .* paid/.test(body));
  check("D: advisor still sees the trips list", (await page.locator("[data-trip]").count()) > 0 || /No trips yet/.test(body));
  check("D: advisor can still create a pick-up", (await page.locator("[data-new-pickup]").count()) === 1);
  await browser.close();
}
{
  const { browser, page } = await browserFor("accounts");
  await page.goto(`${base}/recovery`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  check("D: accounts see the month totals and exports", (await page.locator("[data-recovery-month]").count()) === 1 && (await page.locator("[data-export-excel]").count()) === 1);
  await browser.close();
}
/* The database itself: an advisor's own credentials read no trip, driver or payout rows (RLS). */
{
  const cookies = await loginCookies("service_advisor");
  const parts = cookies.filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  let raw = parts.map((c) => decodeURIComponent(c.value)).join("");
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
  const token = JSON.parse(raw).access_token;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const get = async (table) => {
    const r = await fetch(`${url}/rest/v1/${table}?select=*&limit=5`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
    return { status: r.status, rows: r.ok ? (await r.json()).length : -1 };
  };
  const trips = await get("recovery_trips");
  check("D: REST recovery_trips as advisor → no rows", trips.rows === 0 || trips.status === 403, JSON.stringify(trips));
  const payouts = await get("recovery_payouts");
  check("D: REST recovery_payouts as advisor → no rows", payouts.rows === 0 || payouts.status === 403, JSON.stringify(payouts));
  const drivers = await get("recovery_drivers");
  check("D: REST recovery_drivers as advisor → no rows", drivers.rows === 0 || drivers.status === 403, JSON.stringify(drivers));
}

await cleanupDb();
process.exit(summary() ? 1 : 0);
