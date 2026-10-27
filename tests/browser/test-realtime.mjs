// Section 5.1 of 27 October (afternoon): live updates instead of timed re-checks. An idle live screen asks the server
// NOTHING while the live connection is up (no 30-second re-render, no 30-second bell call); a change arrives within
// seconds through Realtime; a new notification rings the bell without a server call; with the live connection
// down, the screen falls back to one check a minute.
//   node --env-file=.env.local tests/browser/test-realtime.mjs   (dev server)
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
cleanupDb();

const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed"); process.exit(1); }
const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;

const { browser, context, page } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
const calls = { rsc: 0, bell: 0 };
page.on("request", (r) => {
  const u = r.url();
  if (r.headers()["rsc"] === "1" || /[?&]_rsc=/.test(u)) calls.rsc++;
  if (u.includes("/api/notifications") && r.method() === "GET") calls.bell++;
});
try {
  await go(page, `${base}/dashboard`);
  await page.waitForSelector(`[data-flash-id="${jobId}"]`, { timeout: 30000 });
  await sleep(8000); // the live connection settles
  calls.rsc = 0;
  calls.bell = 0;
  await sleep(70000);
  check("1: an idle live screen asks the server nothing for 70 seconds (was a re-render every 30 s)", calls.rsc === 0, `rsc ${calls.rsc}`);
  check("1: the bell asks the server nothing for 70 seconds (was every 30 s)", calls.bell === 0, `bell ${calls.bell}`);

  // A change arrives through the live feed.
  await sql("update public.jobs set promised_at = now() + interval '3 days', updated_at = now() where id = $1", [jobId]);
  let waited = 0;
  while (calls.rsc === 0 && waited < 15000) { await sleep(500); waited += 500; }
  check("2: a change to a car refreshes the screen within seconds", calls.rsc > 0, `${waited} ms`);

  // A new notification rings the bell without asking the server.
  const before = calls.bell;
  const badgeText = async () => ((await page.locator("#header-bell-slot").textContent().catch(() => "")) ?? "").replace(/\D/g, "");
  const badge0 = await badgeText();
  await sql("insert into public.notifications (id, staff_id, type, title, body, href) values (gen_random_uuid(), $1, 'e2e_live', 'E2E live bell check', 'Sent by the realtime test', $2)", [ownerId, `/jobs/${jobId}`]);
  let got = false;
  for (let i = 0; i < 20 && !got; i++) { await sleep(500); got = (await page.getByText("E2E live bell check").count()) > 0 || (await badgeText()) !== badge0; }
  check("3: a new notification reaches the bell through the live feed", got);
  check("3: …without a server call", calls.bell === before, `bell ${calls.bell - before}`);
  await page.screenshot({ path: "tests/browser/shots/realtime-bell.png" });
} finally {
  await sql("delete from public.notifications where type = 'e2e_live'").catch(() => null);
  await browser.close();
}

// 4. With the live connection cut, the screen checks the server once a minute (the fallback).
const b2 = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
let rsc2 = 0;
await b2.context.routeWebSocket(/realtime/, (ws) => ws.close());
b2.page.on("request", (r) => { if (r.headers()["rsc"] === "1" || /[?&]_rsc=/.test(r.url())) rsc2++; });
try {
  await go(b2.page, `${base}/dashboard`);
  await b2.page.waitForSelector(`[data-flash-id="${jobId}"]`, { timeout: 30000 });
  rsc2 = 0;
  await sleep(80000);
  check("4: with the live connection down, the screen falls back to about one check a minute", rsc2 >= 1 && rsc2 <= 2, `rsc ${rsc2}`);
} finally {
  await b2.browser.close();
}
void context;

cleanupDb();
process.exit(summary() ? 1 : 0);
