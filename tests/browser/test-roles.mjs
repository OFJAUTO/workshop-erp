// Every role opens every kind of page it may use (30 October 2026, batch 2 section 3.3). On the TEST database.
// Allowed (by the role rules in src/lib/roles.ts) = the page opens properly; not allowed = refused with a reason (the
// "Not here" page) or sent to the right page instead - never a server error, never an unexplained "Not here".
// Roles: owner, service advisor, accounts, gate-in, workshop manager (mechanical), bodyshop manager, team leader,
// technician, parts, QC inspector; the car wash page (washCars) and the recovery driver's link (no login).
// Pages: calendar, booking (new and one), estimate (new and one), quotation, job card, car page, customer page, gate-in,
// gate-out, recovery trips, invoice, car wash, my jobs. The result table: tests/browser/shots/roles/roles-result.md.
//   node --env-file=.env.test.local tests/browser/test-roles.mjs        (npm run test:roles)
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { MANAGER_MECH, api, base, cleanupDb, cookieHeader, here, makeChecks, projectRoot, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = path.join(here, "shots", "roles");
fs.mkdirSync(OUT, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
const { can } = await import(pathToFileURL(path.join(projectRoot, "src", "lib", "roles.ts")).href);

/** GET a page as a person, following the redirects the app gives: the final page, its status and its text. */
async function open(cookie, p) {
  let url = `${base}${p}`;
  for (let hop = 0; hop < 6; hop++) {
    const r = await fetch(url, { headers: cookie ? { cookie } : {}, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      url = new URL(r.headers.get("location") ?? "/", url).toString();
      continue;
    }
    const html = await r.text();
    return { status: r.status, final: new URL(url).pathname, search: new URL(url).search, html };
  }
  return { status: 0, final: "(too many redirects)", search: "", html: "" };
}
const outcome = (requested, got) => {
  if (got.status >= 500 || /Something went wrong|Application error/i.test(got.html)) return "BROKEN";
  if (got.final === "/not-here") return `refused: ${new URLSearchParams(got.search).get("r") ?? "missing"}`;
  if (got.final === "/login") return "login";
  if (got.final === requested.split("?")[0] && got.status === 200) return /data-not-here/.test(got.html) ? "refused" : "opens";
  return `sent to ${got.final}`;
};

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const jobId = seed.jobId;
  const job = (await sql("select vehicle_id, customer_id from public.jobs where id = $1", [jobId]))[0];
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
  const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0].id;
  const booking = (await sql("insert into public.appointments (kind, customer_id, vehicle_id, reason, starts_at, duration_minutes, advisor_id, created_by, updated_by) values ('customer_visit', $1, $2, 'E2e roles check', now() + interval '1 day', 30, $3, $3, $3) returning id", [job.customer_id, job.vehicle_id, advisor]))[0].id;
  const estimate = (await sql("insert into public.quotations (kind, customer_id, vehicle_id, validity_days, created_by, updated_by) values ('estimate', $1, $2, 7, $3, $3) returning id", [job.customer_id, job.vehicle_id, owner]))[0].id;
  const qid = seed.quotationId ?? (await sql("select id from public.quotations where job_id = $1 and kind = 'quotation' order by created_at desc limit 1", [jobId]))[0]?.id;
  const invoiceId = (await sql("select id from public.invoices where job_id = $1 and is_active order by created_at desc limit 1", [jobId]))[0]?.id;
  const tripToken = `e2eroles${Date.now()}`;
  await sql("insert into public.recovery_trips (job_id, kind, driver_name, token, location_details, scheduled_date, status, created_by, updated_by) values ($1, 'delivery', 'E2e Driver', $2, 'E2e address', (now() at time zone 'Asia/Dubai')::date, 'booked', $3, $3)", [jobId, tripToken, owner]);

  const PAGES = [
    { name: "Calendar", path: "/calendar", allow: (r) => can(r, "viewCalendar") },
    { name: "New booking", path: "/calendar/new", allow: (r) => can(r, "bookAppointments") },
    { name: "A booking", path: `/calendar/${booking}`, allow: (r) => can(r, "viewCalendar") && !["technician", "qc_inspector"].includes(r) },
    { name: "New estimate", path: "/estimates/new", allow: (r) => can(r, "viewEstimates") },
    { name: "An estimate", path: `/estimates/${estimate}`, allow: (r) => r === "owner" || can(r, "viewEstimates") },
    { name: "Quotation", path: `/jobs/${jobId}/quote/${qid}`, allow: (r) => r === "owner" || r === "service_advisor" },
    { name: "Job card", path: `/jobs/${jobId}`, allow: (r) => can(r, "viewJobs") },
    { name: "Car page", path: `/vehicles/${job.vehicle_id}`, allow: (r) => can(r, "viewVehicles") },
    { name: "Customer page", path: `/customers/${job.customer_id}`, allow: (r) => can(r, "viewCustomers") },
    { name: "Gate-in", path: "/gate-in", allow: (r) => can(r, "gateIn") },
    { name: "Gate-out", path: `/jobs/${jobId}/gate-out`, allow: (r) => can(r, "gateOut") },
    { name: "Recovery trips", path: "/recovery", allow: () => true },
    { name: "Invoice", path: `/invoices/${invoiceId}`, allow: (r) => can(r, "viewInvoices") },
    { name: "Car wash", path: "/wash", allow: (r) => can(r, "washCars") },
    { name: "My jobs", path: "/my-jobs", allow: (r) => can(r, "viewOwnJobs") },
  ];
  const bodyshopManager = (await sql("select id from public.staff where role_id = 'workshop_manager' and is_active and department_id in ('bodyshop', 'paint', 'ppf_tint', 'detailing') order by display_name limit 1"))[0]?.id ?? null;
  const ROLES = [
    { label: "Owner", role: "owner", login: "owner" },
    { label: "Service advisor", role: "service_advisor", login: "service_advisor" },
    { label: "Accounts", role: "accounts", login: "accounts" },
    { label: "Gate-in", role: "gate_in", login: "gate_in" },
    { label: "Workshop manager (mechanical)", role: "workshop_manager", login: MANAGER_MECH },
    bodyshopManager ? { label: "Bodyshop manager", role: "workshop_manager", login: bodyshopManager } : null,
    { label: "Team leader", role: "team_leader", login: "team_leader" },
    { label: "Technician", role: "technician", login: "technician" },
    { label: "Parts", role: "parts", login: "parts" },
    { label: "QC inspector", role: "qc_inspector", login: "qc_inspector" },
  ].filter(Boolean);

  const table = [`| Role | ${PAGES.map((p) => p.name).join(" | ")} |`, `|${"---|".repeat(PAGES.length + 1)}`];
  for (const R of ROLES) {
    const cookie = await cookieHeader(R.login).catch(() => null);
    if (!cookie) { check(`${R.label}: a test login exists`, false); continue; }
    const cells = [];
    for (const p of PAGES) {
      const got = await open(cookie, p.path);
      const o = outcome(p.path, got);
      const allowed = p.allow(R.role);
      const ok = allowed ? o === "opens" : o !== "opens" && o !== "BROKEN" && o !== "login";
      cells.push(`${ok ? "" : "**"}${allowed ? "allowed" : "not allowed"}: ${o}${ok ? "" : "**"}`);
      check(`${R.label} · ${p.name}: ${allowed ? "allowed" : "not allowed"} → ${o}`, ok);
    }
    table.push(`| ${R.label} | ${cells.join(" | ")} |`);
  }
  // The recovery driver: his own link, no login.
  const drive = await open(null, `/drive/${tripToken}`);
  check("Recovery driver: his trip link opens with no login", drive.status === 200 && drive.final === `/drive/${tripToken}` && !/Not here/.test(drive.html));
  table.push(`| Recovery driver (link, no login) | ${drive.status === 200 ? "trip page opens" : `status ${drive.status}`} |`);
  fs.writeFileSync(path.join(OUT, "roles-result.md"), table.join("\n") + "\n");
  console.log("\n" + table.join("\n"));
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
