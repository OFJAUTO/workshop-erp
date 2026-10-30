// Creates the TEST Supabase project (30 October 2026, batch 2 section 1; the owner approved a second project in the Pro
// organization, about USD 10 a month) in the live project's organization and region, waits until it is ready and
// writes .env.test.local (never committed). Prints no secrets. Run once:
//   node --env-file=.env.local scripts/test-db/create-test-project.mjs
// Then: npm run test:db:migrate (the schema), npm run test:db:copy (the records, customers made anonymous).
import fs from "node:fs";
import crypto from "node:crypto";

const TOKEN = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
const LIVE_REF = "uhqcmqudszguqosnjadx";
const NAME = "workshop-erp-test";
const ENV_FILE = ".env.test.local";
if (!TOKEN.startsWith("sbp_")) {
  console.error("SUPABASE_ACCESS_TOKEN (an sbp_ token from supabase.com/dashboard/account/tokens) is missing in .env.local.");
  process.exit(1);
}
if (fs.existsSync(ENV_FILE) && /NEXT_PUBLIC_SUPABASE_URL=https:\/\//.test(fs.readFileSync(ENV_FILE, "utf8"))) {
  console.log(`${ENV_FILE} already points at a test project: nothing created.`);
  process.exit(0);
}

async function api(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 300)}`);
  return json;
}

const projects = await api("GET", "/v1/projects");
const live = projects.find((p) => (p.id ?? p.ref) === LIVE_REF);
if (!live) throw new Error("The live project is not in this account's list.");
if (projects.some((p) => p.name === NAME)) {
  console.error(`A project named ${NAME} already exists, but ${ENV_FILE} is missing: its database password is unknown. Delete it in the dashboard or write ${ENV_FILE} by hand.`);
  process.exit(1);
}
const dbPass = crypto.randomBytes(24).toString("base64url");
const created = await api("POST", "/v1/projects", { name: NAME, organization_id: live.organization_id, region: live.region, db_pass: dbPass, desired_instance_size: "micro" });
const ref = created.id ?? created.ref;
if (!ref || ref === LIVE_REF) throw new Error("The new project has no reference.");
// The password is written at once: it cannot be read back later.
const env = (values) => fs.writeFileSync(ENV_FILE, Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
const values = {
  ERP_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  SUPABASE_DB_PASSWORD: dbPass,
  SUPABASE_ACCESS_TOKEN: "",
  CRON_SECRET: crypto.randomBytes(24).toString("hex"),
  E2E_SECRET: process.env.E2E_SECRET || crypto.randomBytes(24).toString("hex"),
  NGENIUS_ENV: "mock",
};
env(values);
console.log(`Created ${NAME} (${ref}) in ${live.region}. Waiting until it is ready…`);

for (let i = 0; i < 90; i++) {
  const p = await api("GET", `/v1/projects/${ref}`);
  if (p.status === "ACTIVE_HEALTHY") break;
  if (i === 89) throw new Error(`Still ${p.status} after 15 minutes.`);
  await new Promise((r) => setTimeout(r, 10_000));
}
const keys = await api("GET", `/v1/projects/${ref}/api-keys?reveal=true`);
values.NEXT_PUBLIC_SUPABASE_ANON_KEY = keys.find((k) => k.name === "anon")?.api_key ?? "";
values.SUPABASE_SERVICE_ROLE_KEY = keys.find((k) => k.name === "service_role")?.api_key ?? "";
if (!values.NEXT_PUBLIC_SUPABASE_ANON_KEY || !values.SUPABASE_SERVICE_ROLE_KEY) throw new Error("The project's API keys could not be read.");
env(values);
console.log(`Ready. ${ENV_FILE} written (keys not shown).`);
