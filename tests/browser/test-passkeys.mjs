// Login security upgrade (7 November 2026): passkeys, the password rule, 12-hour sign-ins, owner-only removal, logs.
//   node --env-file=.env.test.local tests/browser/test-passkeys.mjs        (npm run test:passkeys; the test server on 3102)
// Runs on the TEST database only. Uses Edge's built-in virtual passkey (Chrome DevTools WebAuthn), its own test people
// ("E2e Passkey …", removed by tests/e2e-cleanup.sql) and a test browser whose user agent carries "ERP-E2E".
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";
import { base, browserFor, cleanupDb, makeChecks, pageReady, projectRoot, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const EDGE = process.env.E2E_BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const UA_PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0 ERP-E2E";
const UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 ERP-E2E";
const PASSWORD = "Kq7mWz2pLx9v";
const SHOTS = path.join(projectRoot, "docs", "proof", "2026-11-07-passkeys");
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }).catch(() => null);
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const run = (s) => !ONLY.length || ONLY.includes(s);

const pinHash = (pin) => { const salt = randomBytes(16).toString("hex"); return `scrypt$${salt}$${scryptSync(pin, salt, 32).toString("hex")}`; };
const { data: ownerRow } = await admin.from("staff").select("id").eq("role_id", "owner").eq("is_active", true).order("display_name").limit(1).single();
const OWNER = ownerRow.id;

async function person(email, name, role, extra = {}) {
  let id = (await admin.from("staff").select("id").eq("display_name", name).maybeSingle()).data?.id;
  if (!id) {
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    id = users?.users.find((u) => u.email === email)?.id;
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw error;
      id = data.user.id;
    }
  }
  const { error: pwErr } = await admin.auth.admin.updateUserById(id, { password: PASSWORD });
  if (pwErr) throw pwErr;
  const { error: sErr } = await admin.from("staff").upsert({ id, full_name: name, display_name: name, role_id: role, department_id: extra.department_id ?? null, team: extra.team ?? null, login_type: extra.login_type ?? "password", is_active: true, created_by: OWNER, updated_by: OWNER });
  if (sErr) throw sErr;
  const { error: pErr } = await admin.from("staff_private").upsert({ staff_id: id, email, pin_hash: pinHash("1234"), pin_must_change: false, pin_failed_attempts: 0, pin_locked_until: null }, { onConflict: "staff_id" });
  if (pErr) throw pErr;
  return id;
}

cleanupDb();
const { data: before } = await admin.from("settings").select("value").eq("key", "passkeys_rollout").maybeSingle();
const rolloutBefore = before?.value ?? "owner";
await admin.from("settings").upsert({ key: "passkeys_rollout", value: "all", label: "Passkeys switched on for (owner = only the owner, all = every passkey role)" }, { onConflict: "key" });

const ADV = await person("e2e-pk-advisor@ofj.test", "E2e Passkey Advisor", "service_advisor");
const GATE = await person("e2e-pk-gate@ofj.test", "E2e Passkey Gate", "gate_in", { login_type: "both" });
const TECH = await person("e2e-pk-tech@ofj.test", "E2e Passkey Tech", "technician", { login_type: "pin", department_id: "mechanical" });
const BSM = await person("e2e-pk-bodyshop@ofj.test", "E2e Passkey Bodyshop Manager", "workshop_manager", { team: "dismantle_refit" });
const devToken = randomBytes(24).toString("hex");
// 13 November 2026 (Section 3): gate-in never signs in on a SHARED tablet, so the test device is gate-in's own personal one.
await sql("insert into public.devices (name, location, kind, staff_id, token_hash) values ('E2e passkey tablet', 'workshop', 'personal', $2, $1)", [createHash("sha256").update(devToken).digest("hex"), GATE]);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
async function fresh(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 }, userAgent: opts.phone ? UA_PHONE : UA_PC, hasTouch: !!opts.phone, isMobile: !!opts.phone });
  if (opts.device) await ctx.addCookies([{ name: "erp_device", value: devToken, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on("dialog", (d) => d.accept().catch(() => null));
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  return { ctx, page, cdp };
}
async function addAuth(cdp, credential) {
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  if (credential) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  return authenticatorId;
}
async function passwordLogin(page, email, password = PASSWORD, keep = false) {
  await page.goto(`${base}/login`, { waitUntil: "load" });
  const f = page.locator("[data-login-password]");
  await f.locator('input[name="email"]').fill(email);
  await f.locator('input[name="password"]').fill(password);
  if (keep) await f.locator('input[name="keep"]').check();
  const was = page.url();
  await f.locator('button[type="submit"]').click();
  await page.waitForURL((u) => u.toString() !== was, { timeout: 30000 }).catch(() => null);
  await pageReady(page);
}
async function passkeyLogin(page, { tablet = false } = {}) {
  const was = page.url();
  if (!tablet) await page.goto(`${base}/login`, { waitUntil: "load" });
  await page.locator("[data-passkey-signin-button]").first().click();
  await page.waitForURL((u) => !/\/login|\/tablet/.test(new URL(u).pathname) && u.toString() !== was, { timeout: 30000 }).catch(() => null);
  await pageReady(page);
}
const cookieOf = async (ctx, name) => (await ctx.cookies()).find((c) => c.name === name)?.value ?? null;
const hoursLeft = async (ctx) => (Number(await cookieOf(ctx, "erp_session_until")) - Date.now()) / 3600_000;
const events = async (staffId) => (await admin.from("sign_in_events").select("method, ok, reason, at").eq("staff_id", staffId).order("at", { ascending: false }).limit(20)).data ?? [];
const changes = async (staffId) => (await admin.from("sign_in_changes").select("kind, detail, by_staff_id, at").eq("staff_id", staffId).order("at", { ascending: false }).limit(20)).data ?? [];
const phones = async (staffId) => (await admin.from("staff_passkeys").select("id, name, removed_at, last_used_at, removed_reason").eq("staff_id", staffId).order("created_at")).data ?? [];
const bells = async (staffId, type) => (await admin.from("notifications").select("title, created_at").eq("staff_id", staffId).eq("type", type).ilike("title", "%E2e Passkey%").order("created_at", { ascending: false }).limit(5)).data ?? [];
async function registerHere(page, name) {
  await page.locator("[data-passkey-name]").fill(name);
  await page.locator('[data-passkey-register="here"]').click();
  await page.locator("[data-passkey-setup-done], [data-passkey-error]").first().waitFor({ timeout: 30000 });
  return (await page.locator("[data-passkey-setup-done]").count()) > 0;
}

let credA = null;
const A = await fresh();

try {
  if (run("A")) {
    console.log("\nA. The sign-in page, the password rule and the first sign-in of a passkey user");
    await A.page.goto(`${base}/login`, { waitUntil: "load" });
    await pageReady(A.page);
    check("A1 the passkey button is on the sign-in page", (await A.page.locator("[data-passkey-signin-button]").count()) === 1);
    check("A2 the password is offered as the backup", /Or use your password \(backup\)/.test(await A.page.locator("[data-login-password]").innerText()));
    await shot(A.page, "01-login-1440");
    await passwordLogin(A.page, "e2e-pk-advisor@ofj.test", PASSWORD, true);
    check("A3 an advisor with no phone lands on 'Set up your phone'", new URL(A.page.url()).pathname === "/passkey/setup", A.page.url());
    const h = await hoursLeft(A.ctx);
    check("A4 'Keep me signed in' ticked: still 12 hours for a passkey user", h > 11.8 && h < 12.2, `${h.toFixed(2)} h`);
    const ev = (await events(ADV))[0];
    check("A5 the password sign-in is logged ('no phone set up yet')", ev?.method === "password" && ev.ok && /no phone/.test(ev.reason ?? ""), JSON.stringify(ev));
    await shot(A.page, "02-setup-page-1440");
    const hint = await A.page.evaluate(async () => {
      const r = await fetch("/api/auth/passkey/options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose: "register", where: "phone" }) });
      const j = await r.json();
      return { status: r.status, hints: j.options?.hints ?? null, uv: j.options?.authenticatorSelection?.userVerification, rk: j.options?.authenticatorSelection?.residentKey, rp: j.options?.rp?.id };
    });
    check("A6 on a PC 'Use my phone' asks the browser for the phone (QR code) first", hint.status === 200 && JSON.stringify(hint.hints) === '["hybrid"]', JSON.stringify(hint));
    check("A7 Face ID / fingerprint required, the key kept on the phone, for the ERP's address only", hint.uv === "required" && hint.rk === "required" && hint.rp === "localhost", JSON.stringify(hint));
  }

  if (run("B")) {
    console.log("\nB. Setting up the first phone");
    const authA = await addAuth(A.cdp);
    const ok = await registerHere(A.page, "E2E virtual phone A");
    check("B1 the phone is set up (Done ✓)", ok, ok ? "" : await A.page.locator("[data-passkey-error]").innerText().catch(() => ""));
    const p = await phones(ADV);
    check("B2 one phone kept for the advisor, with its name", p.length === 1 && p[0].name === "E2E virtual phone A", JSON.stringify(p));
    const ch = (await changes(ADV))[0];
    check("B3 'Phone added' is logged", ch?.kind === "passkey_added" && ch.detail === "E2E virtual phone A", JSON.stringify(ch));
    check("B4 the owner gets a bell", (await bells(OWNER, "passkey_added")).some((b) => /E2e Passkey Advisor set up a phone/.test(b.title)));
    check("B5 the advisor gets a bell too (so a phone added by someone else is noticed)", ((await admin.from("notifications").select("title").eq("staff_id", ADV).eq("type", "passkey_added")).data ?? []).length >= 1);
    credA = (await A.cdp.send("WebAuthn.getCredentials", { authenticatorId: authA })).credentials[0];
    await shot(A.page, "03-setup-done-1440");
  }

  if (run("C")) {
    console.log("\nC. Signing in with the passkey");
    await A.ctx.clearCookies();
    await passkeyLogin(A.page);
    check("C1 the passkey signs the advisor in", !["/login", "/passkey/setup"].includes(new URL(A.page.url()).pathname), A.page.url());
    check("C2 the sign-in is marked as a passkey sign-in", (await cookieOf(A.ctx, "erp_login")) === "passkey");
    const h = await hoursLeft(A.ctx);
    check("C3 it lasts 12 hours", h > 11.8 && h < 12.2, `${h.toFixed(2)} h`);
    const ev = (await events(ADV))[0];
    check("C4 the passkey sign-in is logged", ev?.method === "passkey" && ev.ok, JSON.stringify(ev));
    check("C5 the phone shows when it was last used", !!(await phones(ADV))[0]?.last_used_at);
  }

  if (run("D")) {
    console.log("\nD. The password as the backup");
    await A.ctx.clearCookies();
    await passwordLogin(A.page, "e2e-pk-advisor@ofj.test");
    check("D1 the password still works (backup) and goes straight in", !["/login", "/passkey/setup"].includes(new URL(A.page.url()).pathname), A.page.url());
    const ev = (await events(ADV))[0];
    check("D2 logged as 'Password (backup)'", ev?.method === "password_backup" && ev.ok, JSON.stringify(ev));
    check("D3 the owner gets a bell: signed in with the password instead of a phone", (await bells(OWNER, "password_backup_sign_in")).some((b) => /E2e Passkey Advisor signed in with the password instead of a phone/.test(b.title)));
  }

  if (run("E")) {
    console.log("\nE. Adding a second phone");
    await A.page.goto(`${base}/account/sign-in`, { waitUntil: "load" });
    await pageReady(A.page);
    const direct = await A.page.evaluate(async () => {
      const r = await fetch("/api/auth/passkey/options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose: "register", where: "here" }) });
      return { status: r.status, j: await r.json() };
    });
    check("E1 a second phone is refused without approving with the first one", direct.status === 403 && direct.j.needConfirm === true, JSON.stringify(direct));
    await A.page.locator("[data-passkey-confirm]").click();
    await A.page.locator("[data-passkey-name], [data-passkey-error]").first().waitFor({ timeout: 30000 });
    check("E2 approving with phone A opens the next step", (await A.page.locator("[data-passkey-name]").count()) === 1);
    // The second phone is another (empty) device: the first one is put away (disable removes the virtual devices).
    await A.cdp.send("WebAuthn.disable");
    await A.cdp.send("WebAuthn.enable");
    await addAuth(A.cdp);
    const ok = await registerHere(A.page, "E2E virtual phone B");
    check("E3 the second phone is set up", ok, ok ? "" : await A.page.locator("[data-passkey-error]").innerText().catch(() => ""));
    const p = (await phones(ADV)).filter((x) => !x.removed_at);
    check("E4 the advisor now has two phones", p.length === 2, JSON.stringify(p.map((x) => x.name)));
    await A.page.goto(`${base}/account/sign-in`, { waitUntil: "load" });
    await pageReady(A.page);
    check("E5 My sign-in lists both phones", (await A.page.locator("[data-my-phone]").count()) === 2);
    await shot(A.page, "04-my-sign-in-two-phones-1440");
  }

  if (run("F")) {
    console.log("\nF. The owner removes a lost phone; only the owner can");
    const adv403 = await A.page.goto(`${base}/team/sign-ins`, { waitUntil: "load" });
    check("F1 an advisor cannot open the owner's Sign-ins page", !(await A.page.locator("[data-sign-ins-page]").count()), String(adv403?.status()));
    const O = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    await O.page.goto(`${base}/team/sign-ins`, { waitUntil: "load" });
    await pageReady(O.page);
    check("F2 the owner's list shows the advisor with 2 phones", (await O.page.locator(`[data-passkey-person="${ADV}"] [data-phones="2"]`).count()) === 1);
    await shot(O.page, "05-owner-sign-ins-1440");
    const pA = (await phones(ADV)).find((x) => x.name === "E2E virtual phone A");
    await O.page.goto(`${base}/team/${ADV}#sign-in`, { waitUntil: "load" });
    await pageReady(O.page);
    await O.page.locator(`[data-remove-open="${pA.id}"]`).click();
    const row = O.page.locator(`[data-team-phone="${pA.id}"]`);
    await row.locator("[data-remove-reason]").fill("E2E phone lost");
    await row.locator("[data-remove-phone]").click();
    await O.page.getByText("Removed: E2E virtual phone A").first().waitFor({ timeout: 20000 }).catch(() => null);
    const after = (await phones(ADV)).find((x) => x.id === pA.id);
    check("F3 the phone is removed, with the reason", !!after?.removed_at && after.removed_reason === "E2E phone lost", JSON.stringify(after));
    const ch = (await changes(ADV))[0];
    check("F4 'Phone removed' is logged, by the owner", ch?.kind === "passkey_removed" && ch.by_staff_id === OWNER, JSON.stringify(ch));
    await O.page.goto(`${base}/team/${ADV}#sign-in`, { waitUntil: "load" });
    await pageReady(O.page);
    await O.page.locator("[data-team-sign-in]").screenshot({ path: path.join(SHOTS, "06-team-person-sign-in-card-1440.png") }).catch(() => null);
    await O.browser.close();

    // Phone A tries to sign in again.
    const R = await fresh();
    await addAuth(R.cdp, credA);
    await passkeyLogin(R.page);
    const err = await R.page.locator("[data-passkey-error]").innerText().catch(() => "");
    check("F5 the removed phone can no longer sign in, and says why", new URL(R.page.url()).pathname === "/login" && /removed from your sign-in by the owner/.test(err), err);
    const ev = (await events(ADV))[0];
    check("F6 the refused sign-in is logged", ev?.method === "passkey" && !ev.ok && /removed/.test(ev.reason ?? ""), JSON.stringify(ev));
    await R.ctx.close();
  }

  if (run("G")) {
    console.log("\nG. Reset: every phone removed, the advisor sets up again");
    const O = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    await O.page.goto(`${base}/team/${ADV}#sign-in`, { waitUntil: "load" });
    await pageReady(O.page);
    await O.page.locator("[data-reset-open]").click();
    await O.page.locator("[data-reset-reason]").fill("E2E new phone");
    await O.page.locator("[data-reset-phones]").click();
    await O.page.getByText(/Reset: 1 phone removed/).first().waitFor({ timeout: 20000 }).catch(() => null);
    check("G1 no phone is left", (await phones(ADV)).every((x) => !!x.removed_at));
    check("G2 'All phones removed (reset)' is logged", (await changes(ADV))[0]?.kind === "passkeys_reset");
    await O.browser.close();
    await A.ctx.clearCookies();
    await passwordLogin(A.page, "e2e-pk-advisor@ofj.test");
    check("G3 at the next password sign-in the advisor is asked to set up a phone again", new URL(A.page.url()).pathname === "/passkey/setup", A.page.url());
  }

  if (run("H")) {
    console.log("\nH. Gate-in: 'Not now', then a phone, then the PIN no longer signs in");
    const Gp = await fresh({ phone: true, viewport: { width: 390, height: 844 }, device: true });
    await passwordLogin(Gp.page, "e2e-pk-gate@ofj.test");
    check("H1 gate-in with no phone lands on 'Set up your phone'", new URL(Gp.page.url()).pathname === "/passkey/setup", Gp.page.url());
    check("H2 on a phone the main button is 'Use this phone or tablet'", (await Gp.page.locator('[data-passkey-register="here"]').first().innerText()).includes("Use this phone or tablet"));
    await shot(Gp.page, "07-setup-page-phone-390");
    await Gp.page.locator("[data-passkey-skip]").click();
    await Gp.page.waitForURL((u) => new URL(u).pathname !== "/passkey/setup", { timeout: 20000 }).catch(() => null);
    check("H3 'Not now' goes on into the ERP", new URL(Gp.page.url()).pathname !== "/passkey/setup", Gp.page.url());
    check("H4 the skip is logged", (await changes(GATE))[0]?.kind === "setup_skipped");
    const pinBefore = await fetch(`${base}/api/auth/pin`, { method: "POST", headers: { "content-type": "application/json", cookie: `erp_device=${devToken}` }, body: JSON.stringify({ staffId: GATE, pin: "1234" }) });
    check("H5 with no phone yet the PIN still signs gate-in in", pinBefore.status === 200, String(pinBefore.status));
    await Gp.page.goto(`${base}/account/sign-in`, { waitUntil: "load" });
    await pageReady(Gp.page);
    await addAuth(Gp.cdp);
    const ok = await registerHere(Gp.page, "E2E virtual gate phone");
    check("H6 gate-in sets up the phone from My sign-in", ok);
    const pin = await fetch(`${base}/api/auth/pin`, { method: "POST", headers: { "content-type": "application/json", cookie: `erp_device=${devToken}` }, body: JSON.stringify({ staffId: GATE, pin: "1234" }) });
    const pj = await pin.json();
    check("H7 now the PIN no longer signs gate-in in (and says use the passkey)", pin.status === 403 && pj.usePasskey === true, JSON.stringify(pj));
    check("H8 the refused PIN sign-in is logged", (await events(GATE))[0]?.method === "pin" && !(await events(GATE))[0]?.ok);
    await Gp.ctx.clearCookies();
    await Gp.ctx.addCookies([{ name: "erp_device", value: devToken, domain: "localhost", path: "/" }]);
    await Gp.page.goto(`${base}/tablet`, { waitUntil: "load" });
    await Gp.page.getByRole("button", { name: /E2e Passkey Gate/ }).click();
    check("H9 on the tablet, tapping the name shows the passkey button instead of the PIN pad", (await Gp.page.locator("[data-tablet-passkey] [data-passkey-signin-button]").count()) === 1);
    await shot(Gp.page, "08-tablet-passkey-390");
    await passkeyLogin(Gp.page, { tablet: true });
    check("H10 gate-in signs in on the tablet with the passkey", !["/tablet", "/login"].includes(new URL(Gp.page.url()).pathname) && (await cookieOf(Gp.ctx, "erp_login")) === "passkey", Gp.page.url());
    const tech = await fetch(`${base}/api/auth/pin`, { method: "POST", headers: { "content-type": "application/json", cookie: `erp_device=${devToken}` }, body: JSON.stringify({ staffId: TECH, pin: "1234" }) });
    check("H11 a technician's PIN works exactly as before", tech.status === 200, String(tech.status));
    await Gp.ctx.close();
  }

  if (run("I")) {
    console.log("\nI. The bodyshop manager, team leaders and technicians keep their login");
    const B = await fresh();
    await passwordLogin(B.page, "e2e-pk-bodyshop@ofj.test", PASSWORD, true);
    check("I1 the bodyshop manager goes straight in (no phone setup)", !["/passkey/setup", "/login"].includes(new URL(B.page.url()).pathname), B.page.url());
    const h = await hoursLeft(B.ctx);
    check("I2 'Keep me signed in' still lasts days for the bodyshop manager", h > 48, `${h.toFixed(1)} h`);
    const reg = (await B.ctx.request.post(`${base}/api/auth/passkey/options`, { data: { purpose: "register", where: "here" } })).status();
    check("I3 the bodyshop manager cannot set up a passkey", reg === 403, String(reg));
    await B.page.goto(`${base}/account/sign-in`, { waitUntil: "load" });
    check("I4 no phones section on the bodyshop manager's My sign-in", (await B.page.locator("[data-my-phones], [data-passkey-setup]").count()) === 0);
    await B.ctx.close();
    const T = await browserFor("technician");
    const treg = (await T.context.request.post(`${base}/api/auth/passkey/options`, { data: { purpose: "register" } })).status();
    check("I5 a technician cannot set up a passkey", treg === 403 || treg === 401, String(treg));
    await T.browser.close();
  }

  if (run("J")) {
    console.log("\nJ. A long sign-in from before the rule is cut back to 12 hours");
    const J = await fresh();
    await passwordLogin(J.page, "e2e-pk-advisor@ofj.test");
    const thirty = String(Date.now() + 30 * 86400_000);
    await J.ctx.addCookies([{ name: "erp_session_until", value: thirty, domain: "localhost", path: "/", httpOnly: true }]);
    await J.ctx.clearCookies({ name: "erp_cap_checked" }).catch(() => null);
    await J.page.goto(`${base}/home`, { waitUntil: "load" });
    const h = await hoursLeft(J.ctx);
    check("J1 a passkey user's 30-day sign-in now ends within 12 hours", h > 11.8 && h < 12.2, `${h.toFixed(2)} h`);
    await J.ctx.close();
  }

  if (run("K")) {
    console.log("\nK. Change my password: the rule, the leaked-password check and the log");
    await A.ctx.clearCookies();
    await passwordLogin(A.page, "e2e-pk-advisor@ofj.test");
    await A.page.goto(`${base}/auth/set-password`, { waitUntil: "load" });
    const box = A.page.locator("[data-password-box]");
    check("K1 the screen states the rule", (await box.locator("[data-password-rule]").innerText()).startsWith("At least 10 characters, with a small letter, a capital letter and a number."));
    await box.locator('input[name="password"]').fill("abcdefghij");
    check("K2 the ticks follow the typing", (await box.locator('[data-password-check="length"]').getAttribute("data-ok")) === "1" && (await box.locator('[data-password-check="upper"]').getAttribute("data-ok")) === "0");
    await box.locator('input[name="confirm"]').fill("abcdefghij");
    await shot(A.page, "09-change-password-1440");
    let was = A.page.url();
    await A.page.locator('button[type="submit"]').click();
    await A.page.waitForURL((u) => u.toString() !== was, { timeout: 20000 }).catch(() => null);
    check("K3 no capital and no number: refused in plain words", decodeURIComponent(new URL(A.page.url()).searchParams.get("error") ?? "") === "The password needs a capital letter, a number.", A.page.url());
    await A.page.locator('input[name="password"]').fill("Password123");
    await A.page.locator('input[name="confirm"]').fill("Password123");
    was = A.page.url();
    await A.page.locator('button[type="submit"]').click();
    await A.page.waitForURL((u) => u.toString() !== was, { timeout: 20000 }).catch(() => null);
    check("K4 a password from a data leak is refused", /data leak/.test(decodeURIComponent(new URL(A.page.url()).searchParams.get("error") ?? "")), A.page.url());
    const NEW = "Zx8pQm2vLk7w" + randomBytes(2).toString("hex");
    await A.page.locator('input[name="password"]').fill(NEW);
    await A.page.locator('input[name="confirm"]').fill(NEW);
    was = A.page.url();
    await A.page.locator('button[type="submit"]').click();
    await A.page.waitForURL((u) => new URL(u).pathname === "/account/sign-in", { timeout: 20000 }).catch(() => null);
    check("K5 a good password is saved", new URL(A.page.url()).pathname === "/account/sign-in", A.page.url());
    check("K6 'Password changed' is logged", (await changes(ADV))[0]?.kind === "password_changed");
    await A.ctx.clearCookies();
    await passwordLogin(A.page, "e2e-pk-advisor@ofj.test", NEW);
    check("K7 the new password signs in", new URL(A.page.url()).pathname !== "/login", A.page.url());
    await admin.auth.admin.updateUserById(ADV, { password: PASSWORD });
  }

  if (run("L")) {
    console.log("\nL. Rollout 'owner only': nothing changes for the others");
    await admin.from("settings").upsert({ key: "passkeys_rollout", value: "owner", label: "x" }, { onConflict: "key" });
    await sleep(500);
    const Lc = await fresh();
    await passwordLogin(Lc.page, "e2e-pk-advisor@ofj.test", PASSWORD, true);
    check("L1 with passkeys on for the owner only, the advisor goes straight in", !["/login", "/passkey/setup"].includes(new URL(Lc.page.url()).pathname), Lc.page.url());
    const h = await hoursLeft(Lc.ctx);
    check("L2 and 'Keep me signed in' works as before", h > 48, `${h.toFixed(1)} h`);
    await Lc.ctx.close();
    await admin.from("settings").upsert({ key: "passkeys_rollout", value: "all", label: "x" }, { onConflict: "key" });
  }

  if (run("M")) {
    console.log("\nM. A new person in a passkey role: setup link → password → phone");
    const NEWP = await person("e2e-pk-new@ofj.test", "E2e Passkey New Advisor", "service_advisor");
    const token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { error: linkErr } = await admin.from("setup_links").insert({ staff_id: NEWP, token_hash: tokenHash, expires_at: new Date(Date.now() + 86400_000).toISOString(), created_by: OWNER });
    if (linkErr) console.log("   setup link not made:", linkErr.message);
    const N = await fresh();
    await N.page.goto(`${base}/auth/setup/${token}`, { waitUntil: "load" });
    check("M1 the setup link page shows the rule", ((await N.page.locator("[data-password-rule]").innerText().catch(() => "")) || "").startsWith("At least 10 characters"));
    await N.page.locator('input[name="password"]').fill("short");
    await N.page.locator('input[name="confirm"]').fill("short");
    await N.page.evaluate(() => document.querySelectorAll("input[minlength]").forEach((i) => i.removeAttribute("minlength")));
    let was = N.page.url();
    await N.page.locator('button[type="submit"]').click();
    await N.page.waitForURL((u) => u.toString() !== was, { timeout: 20000 }).catch(() => null);
    check("M2 a short password is refused with the same words as everywhere", /The password needs at least 10 characters, a capital letter, a number\./.test(decodeURIComponent(N.page.url())), N.page.url());
    const good = "Nw5tRb8kQz3m";
    await N.page.locator('input[name="password"]').fill(good);
    await N.page.locator('input[name="confirm"]').fill(good);
    was = N.page.url();
    await N.page.locator('button[type="submit"]').click();
    await N.page.waitForURL((u) => new URL(u).pathname === "/passkey/setup", { timeout: 25000 }).catch(() => null);
    check("M3 straight after choosing the password, the new person is asked to set up their phone", new URL(N.page.url()).pathname === "/passkey/setup", N.page.url());
    check("M4 'Password chosen (setup link)' is logged", (await changes(NEWP)).some((c) => c.kind === "password_set"));
    await N.ctx.close();
  }
} finally {
  await browser.close().catch(() => null);
  await admin.from("settings").upsert({ key: "passkeys_rollout", value: rolloutBefore, label: "Passkeys switched on for (owner = only the owner, all = every passkey role)" }, { onConflict: "key" });
  await sql("update public.devices set is_active = false where name = 'E2e passkey tablet'").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
