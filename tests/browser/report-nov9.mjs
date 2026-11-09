// Before/after report for the owner's list of 8 November 2026 (parts 2 and 4), on the TEST copy of live
// (npm run test:db:copy first; never on live):
//   - "urgent" on Waiting on you under the old rule and the new rule, per role (the panel's data-waiting-urgent-old,
//     shown on the test server only);
//   - the bell's count per role before (every unread notice) and after (open actions only, once done tasks cleared).
//   node --env-file=.env.test.local --import ./tests/unit/register.mjs tests/browser/report-nov9.mjs
import { base, browserFor, sql, go } from "./pw-lib.mjs";

const roles = ["owner", "service_advisor", "workshop_manager", "parts", "accounts", "technician"];
console.log("URGENT on Waiting on you (old rule → new rule):");
for (const role of roles) {
  const b = await browserFor(role, { viewport: { width: 1440, height: 900 } });
  await go(b.page, `${base}/dashboard`);
  const panel = b.page.locator("[data-waiting-panel]").first();
  const total = await panel.getAttribute("data-waiting-count").catch(() => null);
  const now = await panel.getAttribute("data-waiting-urgent-count").catch(() => null);
  const old = await panel.getAttribute("data-waiting-urgent-old").catch(() => null);
  console.log(`  ${role.padEnd(17)} ${total ?? 0} waiting · old rule ${old ?? 0} urgent → new rule ${now ?? 0} urgent`);
  await b.browser.close();
}

const { ACTION_RULES } = await import("../../src/lib/bell-rules.ts");
const actions = Object.keys(ACTION_RULES);
const byRole = async (onlyActions) => sql(
  `select s.role_id as role, count(n.*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id
    where n.read_at is null and s.is_active ${onlyActions ? "and n.type = any($1::text[])" : ""} group by 1 order by 2 desc`,
  onlyActions ? [actions] : [],
);
const before = await byRole(false);
const { clearDoneNotices } = await import("../../src/lib/bell-clear.ts");
const r = await clearDoneNotices();
const after = await byRole(true);
console.log(`\nBELL per role (before = every unread notice; after = open actions only; ${r.cleared} done tasks cleared of ${r.checked} checked):`);
const a = new Map(after.map((x) => [x.role, x.n]));
for (const x of before) console.log(`  ${String(x.role).padEnd(17)} ${String(x.n).padStart(5)} → ${a.get(x.role) ?? 0}`);
process.exit(0);
