// Proof for section A of the 16 October batch: the parts list tick is live (green at once, "check again" when the
// list changes, the approval box forgets its refusal); the document PDFs open for the owner, advisors, workshop
// managers and accounts (LPOs for Parts too), refuse other roles and strangers in plain words, and a made-up id is
// refused. Also B1: the gate-in page opens at the top with nothing focused and no red messages.
//   node --env-file=.env.local tests/browser/test-q.mjs
import { api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, makeChecks, sleep, sql, MANAGER_MECH } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
async function fetchAs(pathname, role) {
  const res = await fetch(`${base}${pathname}`, { headers: role ? { cookie: await cookieHeader(role) } : {}, redirect: "manual" });
  return { status: res.status, type: res.headers.get("content-type") ?? "", text: res.ok ? "" : await res.text() };
}
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}

/* ---------------- 1. The parts list tick is live ---------------- */
await section("1 live parts list tick", async () => {
  const seed = await api("/api/e2e/stage", { stage: "inspection" });
  const { jobId, inspectionId } = seed.json;
  await sql("update public.inspections set status = 'submitted', submitted_at = now(), parts_list = '[{\"id\":\"e2e1\",\"name\":\"Front brake pads\",\"qty\":1,\"positions\":[],\"source\":\"custom\"}]'::jsonb where id = $1", [inspectionId]);
  await sql("update public.jobs set status = 'in_inspection' where id = $1", [jobId]);
  const { browser, page } = await browserForId(MANAGER_MECH, { viewport: { width: 1366, height: 1200 } });
  await go(page, `${base}/jobs/${jobId}/inspection`);
  check("1: the tick starts off", (await page.locator('[data-parts-tick="off"]').count()) === 1);
  await page.locator('[data-parts-tick="off"] button').click();
  const on = await until(async () => ((await page.locator('[data-parts-tick="on"]').count()) ? 1 : null), 30, 300);
  check("1: the tick turns green at once, no reload", !!on && /I have checked the parts list/.test(await page.locator('[data-parts-tick="on"]').textContent()));
  const db = (await sql("select parts_list_confirmed_at from public.inspections where id = $1", [inspectionId]))[0];
  check("1: the tick is saved", !!db?.parts_list_confirmed_at);
  // The review form's autosave changes the list: the server takes the tick off and says so.
  const res = await fetch(`${base}/api/inspection/save`, { method: "POST", headers: { "content-type": "application/json", cookie: await cookieHeader(MANAGER_MECH) }, body: JSON.stringify({ inspectionId, partsList: [{ id: "e2e1", name: "Front brake pads", qty: 2, positions: [], source: "custom" }] }) });
  const j = await res.json().catch(() => ({}));
  check("1: a changed list clears the tick and the save says so", res.status === 200 && j.tickCleared === true && !(await sql("select parts_list_confirmed_at from public.inspections where id = $1", [inspectionId]))[0]?.parts_list_confirmed_at, JSON.stringify(j));
  // The page hears it (the form raises the same event on its own saves) and shows "check again".
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("erp-parts-list-changed")));
  const changed = await until(async () => ((await page.locator('[data-parts-tick="changed"]').count()) ? 1 : null), 20, 200);
  check("1: the tick shows 'Parts list changed: check again' instead of green", !!changed && (await page.locator("[data-parts-tick-changed]").count()) === 1 && (await page.locator('[data-parts-tick="on"]').count()) === 0);
  // Approving now is refused in words; ticking again clears the refusal without a reload.
  await page.locator('#approve-form [name="manager_note"]').fill("Checked, nothing else");
  await page.locator("#approve-form").evaluate((f) => f.requestSubmit());
  const refused = await until(async () => /Tick .I have checked the parts list. under the parts list first/.test((await page.textContent("body")) ?? "") ? 1 : null, 30, 300);
  check("1: approving without the tick is refused in words", !!refused);
  await page.locator('[data-parts-tick="changed"] button').click();
  const green = await until(async () => ((await page.locator('[data-parts-tick="on"]').count()) ? 1 : null), 30, 300);
  await sleep(500);
  check("1: ticking again turns it green and the refusal disappears without a reload", !!green && !/Tick .I have checked the parts list. under the parts list first/.test((await page.textContent("body")) ?? ""));
  await browser.close();
});

/* ---------------- 2. Document PDFs open for the right people ---------------- */
await section("2 pdf access", async () => {
  cleanupDb();
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const qid = seed.json.quotationId;
  for (const role of ["owner", "service_advisor", "workshop_manager", "accounts"]) {
    const r = await fetchAs(`/api/pdf/quotation/${qid}`, role);
    check(`2: ${role} opens the quotation PDF`, r.status === 200 && /pdf/.test(r.type), `${r.status} ${r.type}`);
  }
  const parts = await fetchAs(`/api/pdf/quotation/${qid}`, "parts");
  check("2: Parts are refused in plain words", parts.status === 403 && /Your role can't open this document/.test(parts.text), `${parts.status} ${parts.text}`);
  const nobody = await fetchAs(`/api/pdf/quotation/${qid}`, null);
  check("2: without a login the answer says to sign in", (nobody.status === 401 && /not signed in/.test(nobody.text)) || nobody.status === 307 || nobody.status === 302, `${nobody.status}`);
  const fake = await fetchAs(`/api/pdf/quotation/11111111-1111-4111-8111-111111111111`, "owner");
  check("2: a made-up id is refused", fake.status === 404);
  const junk = await fetchAs(`/api/pdf/quotation/not-an-id`, "owner");
  check("2: a junk id is refused", junk.status === 404);
  const inv = await fetchAs(`/api/pdf/invoice-by-id/11111111-1111-4111-8111-111111111111`, "workshop_manager");
  check("2: the workshop manager may open invoices (a made-up one is not found)", inv.status === 404);
  const poAsParts = await fetchAs(`/api/pdf/po/11111111-1111-4111-8111-111111111111`, "parts");
  check("2: Parts may open LPO PDFs (a made-up one is not found)", poAsParts.status === 404);
  const poAsTech = await fetchAs(`/api/pdf/po/11111111-1111-4111-8111-111111111111`, "technician");
  check("2: a technician is refused the LPO PDF", poAsTech.status === 403);
});

/* ---------------- 3. The gate-in page opens at the top, nothing focused, no red ---------------- */
await section("3 gate-in opens quietly", async () => {
  cleanupDb();
  const seed = await api("/api/e2e/stage", { stage: "assign" });
  const veh = (await sql("select vehicle_id from public.jobs where id = $1", [seed.json.jobId]))[0]?.vehicle_id;
  const { browser: b2, page: p2 } = await browserFor("service_advisor", { viewport: { width: 1024, height: 768 } });
  await go(p2, `${base}/gate-in/new?vehicle=${veh}`);
  await sleep(1200);
  const state = await p2.evaluate(() => ({ y: window.scrollY, active: document.activeElement?.tagName ?? "", activeName: document.activeElement?.getAttribute("name") ?? "", red: document.querySelectorAll(".erp-field-msg").length, invalid: document.querySelectorAll(".erp-invalid").length }));
  check("3: the page opens at the top", state.y < 5, JSON.stringify(state));
  check("3: no box has the cursor on load", state.active === "BODY", JSON.stringify(state));
  check("3: no red messages before the button is pressed", state.red === 0 && state.invalid === 0, JSON.stringify(state));
  await b2.close();
});

cleanupDb();
process.exit(summary() ? 1 : 0);
