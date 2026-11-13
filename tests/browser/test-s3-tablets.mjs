// 13 November 2026, Section 3: shared tablets show floor staff only (no accounts, advisors, gate-in, parts or owner, not
// even behind "Someone else?"); an office login cannot sign in by PIN on a shared tablet (the server refuses); five wrong
// PINs lock the tile for 15 minutes and tell the owner. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s3-tablets.mjs
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { base, cleanupDb, makeChecks, setPin, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-tablets";
fs.mkdirSync(OUT, { recursive: true });
const token = randomBytes(24).toString("hex");
let tech = null;

try {
  cleanupDb();
  await sql("insert into public.devices (name, kind, location, department, token_hash) values ('E2e Shared tablet S3', 'shared', 'workshop', 'workshop', $1)", [createHash("sha256").update(token).digest("hex")]);
  const office = await sql("select id, display_name, role_id from public.staff where is_active and login_type in ('pin', 'both') and role_id in ('accounts', 'service_advisor', 'gate_in', 'parts', 'owner')");
  const floor = await sql("select id, display_name from public.staff where is_active and login_type in ('pin', 'both') and role_id in ('technician', 'team_leader', 'qc_inspector')");
  check("0: TEST has office people with a PIN to prove the rule on", office.length > 0, office.map((o) => `${o.display_name} (${o.role_id})`).join(", "));

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const [w, hgt] of [[800, 1280], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, hasTouch: w < 1000 });
    await ctx.addCookies([{ name: "erp_device", value: token, url: base }]);
    const tp = await ctx.newPage();
    await tp.goto(`${base}/tablet`, { waitUntil: "domcontentloaded" });
    await tp.locator("[data-tablet-people]").waitFor({ timeout: 20000 });
    const more = tp.locator("[data-tablet-someone-else]");
    if (await more.count()) await more.click();
    await sleep(500);
    const body = ((await tp.textContent("body")) ?? "").replace(/\s+/g, " ");
    const shown = office.filter((o) => new RegExp(`\\b${o.display_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(body));
    check(`1 (${w}): no office login as a tile, not even behind "Someone else?"`, shown.length === 0, shown.map((o) => o.display_name).join(", "));
    check(`1b (${w}): floor staff are there`, floor.some((f) => body.includes(f.display_name)));
    await tp.screenshot({ path: path.join(OUT, `1-shared-tablet-tiles-${w}.png`) });
    await ctx.close();
  }
  await browser.close();

  // 2. The server refuses an office PIN on a shared tablet, whatever the screen sends.
  const pin = (staffId, p = "1234") => fetch(`${base}/api/auth/pin`, { method: "POST", headers: { "content-type": "application/json", cookie: `erp_device=${token}` }, body: JSON.stringify({ staffId, pin: p }) });
  for (const o of office.filter((x) => ["accounts", "owner"].includes(x.role_id)).slice(0, 2)) {
    await setPin(o.id, "1234");
    const r = await pin(o.id);
    const j = await r.json();
    check(`2: ${o.role_id} cannot sign in by PIN on a shared tablet (refused on the server)`, r.status === 403 && /never sign in on a shared tablet/.test(j.error ?? ""), `${r.status} ${j.error}`);
  }

  // 3. Five wrong PINs lock the tile for 15 minutes and tell the owner.
  tech = floor[0]?.id;
  await setPin(tech, "1234");
  const since = (await sql("select coalesce(max(id), 0) as m from public.notifications"))[0].m;
  let last = null;
  for (let i = 0; i < 5; i++) last = await (await pin(tech, "9999")).json();
  check("3a: the fifth wrong PIN locks the tile for 15 minutes", /locked for 15 minutes/.test(last?.error ?? ""), last?.error);
  const r6 = await (await pin(tech, "1234")).json();
  check("3b: even the right PIN waits until the lock ends", /Too many wrong PINs/.test(r6.error ?? ""), r6.error);
  const told = await sql("select n.title from public.notifications n join public.staff s on s.id = n.staff_id where n.id > $1 and n.type = 'pin_locked' and s.role_id = 'owner'", [since]);
  check("3c: the owner is told", told.length >= 1, JSON.stringify(told.map((t) => t.title)));
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (tech) await sql("update public.staff_private set pin_locked_until = null, pin_failed_attempts = 0 where staff_id = $1", [tech]).catch(() => null);
  await sql("update public.devices set is_active = false where name = 'E2e Shared tablet S3'").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
