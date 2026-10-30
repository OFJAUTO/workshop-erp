// Zoho Books phase 0 (26 October 2026, docs/zoho-plan.md): the connection only. The owner's Connect goes to
// Zoho's own sign-in with a one-time check value in a cookie only the server reads; a lasting permission is asked
// for (offline + consent) with the Books scope; only the owner may connect; an answer that does not match this
// browser, or a cancel on Zoho's page, stores nothing; the settings page carries the picker and the mirror; the
// REAL organization (942979945) is named read-only. Run with test values for ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET
// on the dev server; while a real connection exists, the steps that would disturb it are skipped.
//   node --env-file=.env.test.local tests/browser/test-zoho0.mjs   (dev server; E2E_BASE for another port)
import path from "node:path";
import { base, browserFor, cookieHeader, go, here, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
setTimeout(() => { console.log("TIMEOUT: stopping"); process.exit(2); }, 6 * 60 * 1000).unref();
const realConnection = ((await sql("select count(*)::int as n from public.zoho_tokens where is_active"))[0]?.n ?? 0) > 0;
if (realConnection) console.log("NOTE  a real Zoho connection exists: the token-count checks are skipped");
const ownerCookie = await cookieHeader("owner");

/* 1. The owner's page: Connect (or the env var names when not configured). */
const { browser, page } = await browserFor("owner", { viewport: { width: 1400, height: 1000 } });
try {
  if (!realConnection) {
    // Loading this page with a connection in the shared database would try the token refresh with the dev
    // machine's test secret and write last_error on the REAL row — so it only loads while nothing is connected.
    await go(page, `${base}/settings/zoho`);
    const body = ((await page.textContent("main")) ?? "").replace(/\s+/g, " ");
    const configured = (await page.locator("[data-zoho-connect]").count()) === 1 || /Connected/.test(body);
    check("1: the page offers Connect, or names ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET when unset", configured || /ZOHO_CLIENT_ID/.test(body), body.slice(0, 200));
    check("1: one-way and the read-only rule are said in plain words", /one-way/i.test(body) && /read-only until go-live/i.test(body));
    await page.screenshot({ path: shot("zoho0-1-settings.png"), fullPage: true });
  }
  const settings = await go(page, `${base}/settings`).then(async () => ((await page.textContent("body")) ?? ""));
  check("1: Settings links to Zoho Books", /Zoho Books/.test(settings));

  /* 2. Connect: off to Zoho's own sign-in with the one-time check value. */
  const r = await fetch(`${base}/api/zoho/connect`, { headers: { cookie: ownerCookie }, redirect: "manual" });
  const loc = new URL(r.headers.get("location") ?? "http://none/");
  const setCookie = r.headers.get("set-cookie") ?? "";
  const state = /erp_zoho_state=([^;]+)/.exec(setCookie)?.[1] ?? "";
  check("2: Connect sends the owner to accounts.zoho.com", r.status === 307 && loc.host === "accounts.zoho.com" && loc.pathname === "/oauth/v2/auth", `${r.status} ${loc.href.slice(0, 110)}`);
  check("2: the Books scope, a lasting permission, back to the ERP's own address", loc.searchParams.get("scope") === "ZohoBooks.fullaccess.all" && loc.searchParams.get("access_type") === "offline" && loc.searchParams.get("prompt") === "consent" && loc.searchParams.get("redirect_uri") === `${base}/api/zoho/callback`, loc.search.slice(0, 260));
  check("2: a one-time check value travels with it, kept in a cookie only the server reads", !!state && loc.searchParams.get("state") === state && /HttpOnly/i.test(setCookie));

  /* 3. Only the owner connects. */
  const adv = await fetch(`${base}/api/zoho/connect`, { headers: { cookie: await cookieHeader("service_advisor") }, redirect: "manual" });
  const advLoc = decodeURIComponent(adv.headers.get("location") ?? "");
  check("3: an advisor is refused", adv.status === 307 && /Only the owner/.test(advLoc) && !/accounts\.zoho\.com/.test(advLoc), advLoc.slice(0, 140));

  /* 4. An answer that does not match this browser, or a cancel, stores nothing. */
  const bad = await fetch(`${base}/api/zoho/callback?state=wrong&code=x`, { headers: { cookie: `${ownerCookie}; erp_zoho_state=${state}` }, redirect: "manual" });
  const badLoc = decodeURIComponent(bad.headers.get("location") ?? "");
  check("4: a wrong check value is refused", /did not match/.test(badLoc), badLoc.slice(0, 140));
  const cancel = await fetch(`${base}/api/zoho/callback?state=${state}&error=access_denied`, { headers: { cookie: `${ownerCookie}; erp_zoho_state=${state}` }, redirect: "manual" });
  check("4: cancelled on Zoho's page: nothing connected", /cancelled/.test(decodeURIComponent(cancel.headers.get("location") ?? "")));
  if (!realConnection) {
    check("4: no token was stored", ((await sql("select count(*)::int as n from public.zoho_tokens where is_active"))[0]?.n ?? 0) === 0);
  }

  /* 5. The REAL organization id is pinned in settings and the test org starts empty. */
  const rows = await sql("select key, value::text as v from public.settings where key in ('zoho_org_real', 'zoho_live_enabled')");
  check("5: REAL = 942979945 and the go-live switch is OFF", rows.some((r2) => r2.key === "zoho_org_real" && /942979945/.test(r2.v)) && rows.some((r2) => r2.key === "zoho_live_enabled" && r2.v === "false"), JSON.stringify(rows));
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await browser.close();
}
process.exit(summary() ? 1 : 0);
