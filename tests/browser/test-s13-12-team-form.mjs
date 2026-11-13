// 13 November 2026, Section 12: the team form with two clean levels - Department (Mechanical, Bodyshop, Office) then the
// Team inside it, fields that do not apply to the role hidden, the red "Choose a role." gone once a role is picked,
// the Bodyshop manager title. TEST only (no staff member is created: the one save edits an e2e person and puts them back).
//   node --env-file=.env.test.local tests/browser/test-s13-12-team-form.mjs
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-team-form";
fs.mkdirSync(OUT, { recursive: true });
const txt = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const tile = (page, hook, value) => page.locator(`[data-${hook}] label:has(input[data-pick="${value}"])`);
const tiles = async (page, hook) => page.locator(`[data-${hook}] input[data-pick]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-pick")));
let restore = null;

try {
  cleanupDb();
  const o = await browserFor("owner", { viewport: { width: 1440, height: 900 } });

  // 1. No role: the red message; it goes as soon as a role is picked.
  await go(o.page, `${base}/team/new`);
  await o.page.locator('input[name="full_name"]').fill("E2e Form Check");
  await o.page.locator('input[name="display_name"]').fill("E2e Form");
  await o.page.getByRole("button", { name: "Add staff member" }).click();
  await o.page.locator("div.bg-red-soft", { hasText: "Choose a role." }).first().waitFor({ timeout: 20000 }).catch(() => null);
  check("1: saving with no role says 'Choose a role.'", (await o.page.locator("div.bg-red-soft", { hasText: "Choose a role." }).count()) === 1);
  await tile(o.page, "role-choice", "technician").click();
  await sleep(200);
  check("1: the red message clears as soon as a role is picked", (await o.page.locator("div.bg-red-soft", { hasText: "Choose a role." }).count()) === 0);

  // 2. Technician: Department then Team; the Team box shows only that department's teams; no calendar colour.
  await tile(o.page, "department-choice", "mechanical").click();
  check("2: Mechanical shows Technicians, Electricians, Helpers only", JSON.stringify(await tiles(o.page, "team-choice")) === JSON.stringify(["", "technicians", "electricians", "helpers"]));
  await tile(o.page, "department-choice", "bodyshop").click();
  check("2: Bodyshop shows its four teams only", JSON.stringify(await tiles(o.page, "team-choice")) === JSON.stringify(["", "dismantle_refit", "ppf", "painting", "detailing_cleaning"]) && /PPF and tint/.test(await txt(o.page.locator("[data-team-choice]"))));
  check("2: a technician has no 'Colour on the calendar' and keeps 'Own break'", (await o.page.locator("[data-colour-field]").count()) === 0 && (await o.page.locator("[data-break-field]").count()) === 1);
  await tile(o.page, "team-choice", "painting").click();
  check("2: Bodyshop > Painting is stored as the paint department", (await o.page.locator('input[name="department_id"]').inputValue()) === "paint");
  await o.page.screenshot({ path: `${OUT}/s12-technician-bodyshop-1440.png`, fullPage: true });

  // 3. Service advisor: Office, the team follows the role, the calendar colour shows, no break, no head-accountant tick.
  await tile(o.page, "role-choice", "service_advisor").click();
  await tile(o.page, "department-choice", "office").click();
  check("3: an advisor in Office: 'Team: Advisors', no Team box", /Advisors/.test(await txt(o.page.locator("[data-office-team]"))) && (await o.page.locator("[data-team-choice]").count()) === 0);
  check("3: an advisor has the calendar colour, no own break, no head-accountant tick", (await o.page.locator("[data-colour-field]").count()) === 1 && (await o.page.locator("[data-break-field]").count()) === 0 && (await o.page.locator("[data-head-accountant-field]").count()) === 0);

  // 4. Bodyshop manager is its own choice and puts the person in Bodyshop.
  await tile(o.page, "role-choice", "bodyshop_manager").click();
  check("4: 'Bodyshop manager' picks the Bodyshop department and saves as a workshop manager", (await o.page.locator("[data-department-choice]").getAttribute("data-department-choice")) === "bodyshop" && (await o.page.locator('input[name="role_id"]').inputValue()) === "workshop_manager");
  const o800 = await browserFor("owner", { viewport: { width: 800, height: 1280 }, touch: true });
  await go(o800.page, `${base}/team/new`);
  await tile(o800.page, "role-choice", "technician").click();
  await tile(o800.page, "department-choice", "bodyshop").click();
  await o800.page.screenshot({ path: `${OUT}/s12-team-form-800.png`, fullPage: true });
  await o800.browser.close();

  // 5. Editing a person: Bodyshop > Painting saves as the paint department and the Painting team.
  const bs = await api("/api/e2e/stage", { stage: "bodyshop", at: "in_work" });
  const inst = bs.json?.people?.installer;
  restore = (await sql("select id, department_id, team, role_id from public.staff where id = $1", [inst]))[0];
  await go(o.page, `${base}/team/${inst}`);
  await tile(o.page, "department-choice", "bodyshop").click();
  await tile(o.page, "team-choice", "painting").click();
  await o.page.getByRole("button", { name: "Save changes" }).click();
  const saved = await (async () => { for (let i = 0; i < 40; i++) { const r = (await sql("select department_id, team from public.staff where id = $1", [inst]))[0]; if (r?.team === "painting") return r; await sleep(500); } return null; })();
  check("5: the edit saves Bodyshop > Painting (department paint, team painting)", saved?.department_id === "paint" && saved?.team === "painting", JSON.stringify(saved));
  await go(o.page, `${base}/team/${inst}`);
  check("5: the person page reads 'Bodyshop · Painting'", /Bodyshop · Painting/.test(await txt(o.page.locator("h1 + *, header"))) || /Bodyshop · Painting/.test(await txt(o.page.locator("body"))));

  // 6. The bodyshop manager reads "Bodyshop manager", never "Workshop manager", on the list and his page.
  const bm = (await sql("select id, display_name from public.staff where role_id = 'workshop_manager' and is_active and department_id in ('bodyshop','paint','ppf_tint','detailing') limit 1"))[0];
  if (bm) {
    await go(o.page, `${base}/team`);
    const group = o.page.locator("section", { has: o.page.locator(`a[href="/team/${bm.id}"]`) });
    check("6: on the Team list the bodyshop manager sits under 'Bodyshop manager'", /Bodyshop manager/.test(await txt(group.locator("h2, [data-section-label], span").first())) || /^Bodyshop manager/.test(await txt(group)), (await txt(group)).slice(0, 80));
    await o.page.screenshot({ path: `${OUT}/s12-team-list-1440.png` });
    await go(o.page, `${base}/team/${bm.id}`);
    const sub = await txt(o.page.locator("body"));
    check("6: his page says Bodyshop manager, not Workshop manager", /Bodyshop manager/.test(sub) && !/Workshop manager ·/.test(sub));
  } else check("6: a bodyshop manager exists on TEST", false);
  await o.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (restore) await sql("update public.staff set department_id = $2, team = $3 where id = $1", [restore.id, restore.department_id, restore.team]).catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
