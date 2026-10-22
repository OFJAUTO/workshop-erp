// The automatic layout check: logs in as every role, opens every page in that role's menu, and at
// 1920 / 1366 / 1024 / 800 wide fails when anything interactive overlaps something else, is cut off at
// the right edge, or the page scrolls sideways. Screenshots land in tests/browser/shots/layout/.
// Run after every batch, before reporting done:  npm run test:layout
import { mkdirSync } from "node:fs";
import { MANAGER_MECH, browserFor, browserForId, base, go, sql } from "./pw-lib.mjs";

mkdirSync("tests/browser/shots/layout", { recursive: true });
const WIDTHS = [1920, 1366, 1024, 800];
const onlyRole = process.env.ROLE ?? "";

/** What counts as a problem on one page, measured inside the real browser. */
async function problemsOn(page) {
  return page.evaluate(() => {
    const problems = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) problems.push(`horizontal scroll (page ${doc.scrollWidth}px in a ${window.innerWidth}px window)`);
    const els = [...document.querySelectorAll("button, a[href], input, select, textarea, [role='button']")].filter((el) => {
      if (el.closest("[aria-hidden='true']") || el.closest("[data-overlap-ok]") || el.closest("dialog")) return false;
      // Chromium keeps layout boxes for content inside a CLOSED <details> (hidden-until-found): not on screen.
      for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) {
        if (!d.open && !(el.closest("summary") && d.contains(el.closest("summary")))) return false;
      }
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      // Rows inside a sideways-scrolling strip clip themselves; what is scrolled out of such a strip is not on screen.
      let n = el.parentElement;
      while (n && n !== document.body) {
        const ncs = getComputedStyle(n);
        if ((ncs.overflowX === "auto" || ncs.overflowX === "scroll") && n.scrollWidth > n.clientWidth + 1) {
          const nr = n.getBoundingClientRect();
          if (r.right <= nr.left + 1 || r.left >= nr.right - 1) return false;
        }
        n = n.parentElement;
      }
      return true;
    });
    const rects = els.map((el) => ({ el, r: el.getBoundingClientRect() }));
    const label = (el) => `${el.tagName.toLowerCase()} "${((el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim()).slice(0, 40)}"`;
    const inBottomBar = (el) => {
      let n = el;
      while (n && n !== document.body) {
        const p = getComputedStyle(n).position;
        if (p === "fixed" || p === "sticky") return n.getBoundingClientRect().top > window.innerHeight * 0.55;
        n = n.parentElement;
      }
      return false;
    };
    const inSidewaysScroller = (el) => {
      // A box clipped by its own overflow-x-auto strip can be scrolled into view: that is the strip working, not a cut-off.
      let n = el.parentElement;
      while (n && n !== document.body) {
        const ncs = getComputedStyle(n);
        if ((ncs.overflowX === "auto" || ncs.overflowX === "scroll") && n.scrollWidth > n.clientWidth + 1 && n.getBoundingClientRect().right <= window.innerWidth + 1) return true;
        n = n.parentElement;
      }
      return false;
    };
    for (const { el, r } of rects) {
      if (r.right > window.innerWidth + 1 && r.left < window.innerWidth - 4 && !inSidewaysScroller(el)) problems.push(`cut off at the right edge: ${label(el)}`);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ox > 4 && oy > 4) {
          if (inBottomBar(a.el) !== inBottomBar(b.el)) continue; // a bottom action bar floats over scrolled content by design
          problems.push(`overlap: ${label(a.el)} ON ${label(b.el)} (${Math.round(ox)}×${Math.round(oy)}px)`);
        }
      }
    }
    return [...new Set(problems)].slice(0, 15);
  });
}

async function roleBrowser(role) {
  if (role.id) return browserForId(role.id, { viewport: { width: 1920, height: 1100 } });
  return browserFor(role.key, { viewport: { width: 1920, height: 1100 } });
}

const technicianId = (await sql("select id from public.staff where role_id = 'technician' and is_active order by display_name limit 1"))[0]?.id ?? null;
const bodyshopId = (await sql("select id from public.staff where is_active and department_id in ('bodyshop', 'paint', 'ppf_tint', 'detailing') and role_id in ('workshop_manager', 'team_leader') order by role_id desc limit 1"))[0]?.id ?? null;
const roles = [
  { name: "owner", key: "owner" },
  { name: "advisor", key: "service_advisor" },
  { name: "parts", key: "parts" },
  { name: "accounts", key: "accounts" },
  { name: "workshop-manager", id: MANAGER_MECH },
  technicianId ? { name: "technician", id: technicianId } : null,
  bodyshopId ? { name: "bodyshop", id: bodyshopId } : null,
].filter(Boolean).filter((r) => !onlyRole || r.name === onlyRole);

// Pages reached from inside another page (not in the menu) that still need checking.
const EXTRA_PAGES = { owner: ["/settings/packages", "/commissions"], accounts: ["/commissions"] };

let pagesChecked = 0;
let shots = 0;
const findings = [];
for (const role of roles) {
  const { browser, page } = await roleBrowser(role);
  await go(page, `${base}/`);
  // Every page in this role's menu, plus wherever the role landed.
  const hrefs = await page.evaluate(() => [...document.querySelectorAll("aside a[href]")].map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/") && !h.startsWith("/api")));
  const landed = new URL(page.url()).pathname;
  const targets = [...new Set([landed, ...hrefs, ...(EXTRA_PAGES[role.name] ?? [])])];
  for (const path of targets) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 1050 });
      try {
        await go(page, `${base}${path}`);
      } catch {
        findings.push(`${role.name} ${path} @${width}: the page did not load`);
        continue;
      }
      await page.waitForTimeout(500);
      const problems = await problemsOn(page).catch((e) => [`check failed: ${String(e).slice(0, 80)}`]);
      pagesChecked++;
      const slug = path.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "home";
      await page.screenshot({ path: `tests/browser/shots/layout/${role.name}-${slug}-${width}.png` }).catch(() => null);
      shots++;
      for (const p of problems) findings.push(`${role.name} ${path} @${width}: ${p}`);
      if (problems.length) console.log(`FAIL ${role.name} ${path} @${width}\n  - ${problems.join("\n  - ")}`);
    }
  }
  await browser.close();
  console.log(`${role.name}: ${targets.length} pages done`);
}
console.log(`\n${pagesChecked} page views checked across ${roles.length} roles and ${WIDTHS.length} widths · ${shots} screenshots in tests/browser/shots/layout/`);
console.log(findings.length ? `${findings.length} problems found` : "No overlaps, nothing cut off, no sideways scrolling.");
process.exit(findings.length ? 1 : 0);
