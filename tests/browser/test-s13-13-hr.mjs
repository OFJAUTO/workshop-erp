// 13 November 2026, Section 13: HR list page and person page - search as you type, tiles as filters, groups (Support
// staff on its own), one status line, sort, "+ Add person", the expiry list (logged), HR indented under Team with only
// the open item lit; the person page's fixed document rows, the Attach window (Take photo on a tablet, several files,
// big photos reduced, preview), the number masked in the page itself, Replace keeps the old file, Other document, and
// role and department read from the Team record. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s13-13-hr.mjs
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-hr";
fs.mkdirSync(OUT, { recursive: true });
const txt = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const NAME = `E2E HR Driver ${Date.now() % 100000}`;
let pid = null;

try {
  cleanupDb();
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  await sql("insert into public.staff_passkeys (staff_id, credential_id, public_key, name) values ($1, $2, 'e2e', 'E2E HR key')", [owner, `e2e-hr13-${Date.now()}`]);
  const o = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  const op = o.page;

  // 1. The menu: HR indented under Team, only HR lit on the HR page.
  await go(op, `${base}/team/hr`);
  const hrLink = op.locator('a[href="/team/hr"][data-nav-sub]').first();
  const teamLink = op.locator('a[href="/team"]:visible').first();
  check("1: HR sits indented under Team", (await hrLink.getAttribute("data-nav-sub")) === "1");
  check("1: only the open item is lit (HR, not Team)", /bg-pill/.test((await hrLink.getAttribute("class")) ?? "") && !/bg-pill/.test((await teamLink.getAttribute("class")) ?? ""));

  // 2. + Add person (no login) with a role from the list: Support staff group, grey status line.
  await op.locator("[data-hr-add-name]").fill(NAME);
  await op.locator("[data-hr-add-role]").selectOption("Driver");
  await op.locator("[data-hr-add-save]").click();
  await op.waitForURL(/\/team\/hr\/[0-9a-f-]{36}/, { timeout: 20000 });
  pid = op.url().match(/hr\/([0-9a-f-]{36})/)[1];
  await go(op, `${base}/team/hr`);
  const total = Number(((await txt(op.locator("[data-hr-shown]"))).match(/of (\d+)/) ?? [])[1] ?? 0);
  await op.locator("[data-hr-search]").fill(NAME.slice(-12));
  await sleep(200);
  check("2: the search filters as you type", (await op.locator("[data-hr-row]").count()) === 1 && total > 1, await txt(op.locator("[data-hr-shown]")));
  const row = op.locator(`[data-hr-row="${pid}"]`);
  check("2: a driver sits under Support staff", (await op.locator('[data-hr-group="Support staff"]').locator(`[data-hr-row="${pid}"]`).count()) === 1);
  check("2: the status line: grey '7 documents missing' and '0 of 7 documents'", (await row.getAttribute("data-hr-tone")) === "grey" && /7 documents missing/.test(await txt(row.locator("[data-hr-status]"))) && /0 of 7 documents/.test(await txt(row)));
  await op.locator("[data-hr-search]").fill("");
  await op.locator('[data-hr-tile="missing"]').click();
  const missingCount = Number(await op.locator('[data-hr-tile="missing"]').getAttribute("data-count"));
  check("2: the Documents missing tile filters the list to its count", (await op.locator("[data-hr-row]").count()) === missingCount && missingCount >= 1);
  await op.locator('[data-hr-tile="missing"]').click();
  check("2: the four tiles and the two sorts are there", (await op.locator("[data-hr-tile]").count()) === 4 && (await op.locator('[data-hr-sort="attention"][aria-pressed="true"]').count()) === 1 && (await op.locator('[data-hr-sort="az"]').count()) === 1);
  check("2: groups have chips to jump to", (await op.locator("[data-hr-chip]").count()) >= 2);
  await op.screenshot({ path: `${OUT}/s13-hr-list-1440.png` });
  const dl = await op.request.get(`${base}/api/hr/expiry-list`);
  check("2: Download expiry list gives an Excel file", dl.status() === 200 && /spreadsheetml/.test(dl.headers()["content-type"] ?? ""));
  const logged = await sql("select count(*)::int n from public.hr_access_log where action = 'downloaded_expiry_list' and by_staff_id = $1 and at > now() - interval '5 minutes'", [owner]);
  check("2: the download is logged", logged[0]?.n >= 1);

  // 3. The person page: a fixed row per document, Missing with Attach; Choose file only on a computer.
  await go(op, `${base}/team/hr/${pid}`);
  check("3: seven fixed document rows, each Missing with Attach", (await op.locator("[data-hr-doc][data-hr-doc-state='missing']").count()) === 7 && (await op.locator("[data-hr-doc] [data-hr-attach]").count()) === 7);
  check("3: role and department from the list for someone with no login", (await op.locator("[data-hr-role]").count()) === 1 && (await op.locator("[data-hr-department]").count()) === 1);
  await op.locator('[data-hr-attach="emirates_id"]').click();
  const win = op.locator('[data-hr-attach-window="emirates_id"]');
  check("3: on a computer: Choose file (no Take photo)", (await win.locator("[data-hr-choose-file]").count()) === 1 && (await win.locator("[data-hr-take-photo]").count()) === 0);
  // A big photo (over 4 MB as taken) and a back side: both previewed, the big one reduced on the device.
  const big = Buffer.from(await op.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 5000; c.height = 3750;
    const g = c.getContext("2d");
    for (let i = 0; i < 40000; i++) { g.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 50)}%)`; g.fillRect(Math.random() * 5000, Math.random() * 3750, 4 + Math.random() * 40, 4 + Math.random() * 40); }
    const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 1));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }));
  const small = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await win.locator("[data-hr-file-input]").setInputFiles([{ name: "eid-front.jpg", mimeType: "image/jpeg", buffer: big }, { name: "eid-back.png", mimeType: "image/png", buffer: small }]);
  await win.locator("[data-hr-preview]").nth(1).waitFor({ timeout: 20000 }).catch(() => null);
  check(`3: both files previewed before saving (big photo ${(big.length / 1048576).toFixed(1)} MB)`, (await win.locator("[data-hr-preview]").count()) === 2 && big.length > 4 * 1048576);
  await win.locator("[data-hr-number-input]").fill("784199012345671");
  const exp = new Date(Date.now() + 4 * 3600000 + 300 * 86400000).toISOString().slice(0, 10);
  await win.locator("[data-hr-expiry-input]").fill(exp);
  await op.screenshot({ path: `${OUT}/s13-attach-window-1440.png` });
  await win.locator("[data-hr-attach-save]").click();
  await op.locator('[data-hr-doc="emirates_id"][data-hr-doc-state="have"]').waitFor({ timeout: 30000 }).catch(() => null);
  const eid = op.locator('[data-hr-doc="emirates_id"]');
  const stored = await sql("select count(*)::int n from public.hr_documents where person_id = $1 and kind = 'emirates_id' and replaced_at is null and is_active", [pid]);
  check("3: one document, two files (front and back)", stored[0]?.n === 2 && /2 files/.test(await txt(eid)));
  check("3: the big photo was reduced, not refused", (await eid.count()) === 1 && (await op.locator("[data-hr-attach-error]").count()) === 0);
  check("3: days left in green for a valid document", (await eid.locator('[data-hr-expiry="green"]').count()) === 1);
  const html = await op.content();
  check("3: the number is masked in the page itself (the full number is not sent)", !html.includes("784199012345671") && /•+671/.test(await txt(eid.locator("[data-hr-number]"))));
  await op.screenshot({ path: `${OUT}/s13-person-1440.png`, fullPage: true });

  // 4. Replace keeps the old files.
  await eid.locator('[data-hr-attach="emirates_id"]').click();
  const win2 = op.locator('[data-hr-attach-window="emirates_id"]');
  await win2.locator("[data-hr-file-input]").setInputFiles({ name: "eid-new.png", mimeType: "image/png", buffer: small });
  await win2.locator("[data-hr-preview]").first().waitFor({ timeout: 10000 }).catch(() => null);
  await win2.locator("[data-hr-expiry-input]").fill(exp);
  await win2.locator("[data-hr-attach-save]").click();
  await op.locator("summary", { hasText: "Replaced documents (2)" }).waitFor({ timeout: 30000 }).catch(() => null);
  check("4: Replace keeps the old files under 'Replaced documents'", (await op.locator("summary", { hasText: "Replaced documents (2)" }).count()) === 1);

  // 5. Other document (TEST has the migration).
  if (await op.locator("[data-hr-other]").count()) {
    await op.locator('[data-hr-attach="other"]').click();
    const w3 = op.locator('[data-hr-attach-window="other"]');
    await w3.locator("[data-hr-other-label]").fill("Trade licence");
    await w3.locator("[data-hr-file-input]").setInputFiles({ name: "tl.png", mimeType: "image/png", buffer: small });
    await w3.locator("[data-hr-preview]").first().waitFor({ timeout: 10000 }).catch(() => null);
    await w3.locator("[data-hr-attach-save]").click();
    await op.locator('[data-hr-doc="other"]').waitFor({ timeout: 30000 }).catch(() => null);
    check("5: an Other document with its own name", /Trade licence/i.test(await txt(op.locator('[data-hr-doc="other"]'))));
  } else check("5: Other document shows once its migration is applied (TEST)", false);

  // 6. A person with an ERP login: role and department read from the Team record.
  const bs = await api("/api/e2e/stage", { stage: "bodyshop", at: "in_work" });
  const inst = bs.json?.people?.installer;
  await go(op, `${base}/team/hr`);
  await op.locator(`[data-hr-open-staff="${inst}"], [data-hr-row] a[data-hr-open]`).first().waitFor({ timeout: 5000 }).catch(() => null);
  const openBtn = op.locator(`[data-hr-open-staff="${inst}"]`);
  if (await openBtn.count()) await openBtn.click();
  else await op.locator(`[data-hr-row]`, { hasText: "E2E INSTALLER" }).locator("[data-hr-open]").click();
  await op.waitForURL(/\/team\/hr\/[0-9a-f-]{36}/, { timeout: 20000 });
  const rec = await txt(op.locator("[data-hr-team-record]"));
  check("6: role and department come from the Team record (no boxes to type)", /Technician/.test(rec) && /Bodyshop/.test(rec) && (await op.locator("[data-hr-role]").count()) === 0, rec);
  await o.browser.close();

  // 7. A tablet: Take photo and Choose file.
  const t = await browserFor("owner", { viewport: { width: 800, height: 1280 }, touch: true });
  await go(t.page, `${base}/team/hr/${pid}`);
  await t.page.locator('[data-hr-attach="passport"]').click();
  check("7: on a tablet: Take photo and Choose file", (await t.page.locator("[data-hr-take-photo]").count()) === 1 && (await t.page.locator("[data-hr-choose-file]").count()) === 1);
  await t.page.screenshot({ path: `${OUT}/s13-attach-tablet-800.png` });
  await go(t.page, `${base}/team/hr`);
  await t.page.screenshot({ path: `${OUT}/s13-hr-list-800.png` });
  await t.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (pid) await sql("update public.hr_people set status = 'left', left_at = now(), left_reason = 'E2E test person' where id = $1", [pid]).catch(() => null);
  await sql("delete from public.staff_passkeys where name = 'E2E HR key'").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
