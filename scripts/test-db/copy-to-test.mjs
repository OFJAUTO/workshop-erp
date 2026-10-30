// Fills the TEST database with a copy of the live records (30 October 2026, batch 2 section 1.2). Customers' names,
// phones, emails, addresses and the people who brought or collected cars are replaced by made-up ones, in their own
// columns AND wherever they appear inside notes and histories. Staff keep their names (the tests pick people by name)
// but get made-up emails and phones, every PIN becomes 1234, and each staff member gets a sign-in on the test project.
// The LIVE connection is read-only for the whole run (default_transaction_read_only): nothing on live can change.
// Never copied: sign-in/upload/payment links and codes, tokens (Zoho, Google), the change log, errors, notifications,
// registered devices, the Zoho queue. Files in storage are not copied (pictures show as missing on the test site).
//   node --env-file=.env.local scripts/test-db/copy-to-test.mjs        (npm run test:db:copy; re-run any time)
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";

const LIVE_REF = "uhqcmqudszguqosnjadx";
const TEST_PIN = "1234";
const testEnv = Object.fromEntries(
  fs.readFileSync(".env.test.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const refOf = (url) => (url ?? "").replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const liveRef = refOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const testRef = refOf(testEnv.NEXT_PUBLIC_SUPABASE_URL);
if (liveRef !== LIVE_REF) throw new Error("Run with --env-file=.env.local (the live project is the source).");
if (testEnv.ERP_ENV !== "test" || !testRef || testRef === LIVE_REF) throw new Error(".env.test.local must point at the TEST project.");

const connect = async (ref, password) => {
  const c = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password, database: "postgres", ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
};
const live = await connect(liveRef, process.env.SUPABASE_DB_PASSWORD);
await live.query("set default_transaction_read_only = on");
const test = await connect(testRef, testEnv.SUPABASE_DB_PASSWORD);

const SKIP = new Set([
  "audit_log", "app_errors", "upload_failures", "background_jobs", "notifications", "zoho_outbox", "zoho_outbox_archive",
  "zoho_reconciliation", "zoho_tokens", "google_mailbox_tokens", "setup_links", "quick_codes", "upload_links",
  "payment_links", "payment_requests", "short_links", "devices", "inbound_emails",
]);

/* ---------- made-up people ---------- */
const hashN = (s, mod) => parseInt(crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 8), 16) % mod;
const fakePhone = (seed) => `+97150990${String(hashN(seed, 10000)).padStart(4, "0")}`;
const digits9 = (p) => String(p ?? "").replace(/\D/g, "").slice(-9);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameSwaps = []; // [regex, replacement]
const phoneSwaps = [];
const addName = (real, fake) => {
  const r = String(real ?? "").trim();
  if (r.length >= 3 && r.toLowerCase() !== fake.toLowerCase()) nameSwaps.push([new RegExp(`(?<![\\p{L}\\d])${esc(r)}(?![\\p{L}\\d])`, "giu"), fake]);
};
const addPhone = (real, fake) => {
  const d = digits9(real);
  if (d.length === 9) phoneSwaps.push([new RegExp(d.split("").join("[\\s-]?"), "g"), digits9(fake)]);
};
const { rows: customers } = await live.query("select id, customer_number, full_name, company_name, phone, phone2, email from public.customers");
const fakeCustomer = new Map();
for (const c of customers) {
  const n = Number(String(c.customer_number ?? "").replace(/\D/g, "")) || hashN(c.id, 100000);
  const f = { full_name: `Test Customer ${n}`, company_name: c.company_name ? `Test Company ${n}` : null, phone: fakePhone(`c${c.id}`), phone2: c.phone2 ? fakePhone(`c2${c.id}`) : null, email: c.email ? `customer${n}@example.com` : null };
  fakeCustomer.set(c.id, f);
  addName(c.full_name, f.full_name);
  if (c.company_name) addName(c.company_name, f.company_name);
  addPhone(c.phone, f.phone);
  if (c.phone2) addPhone(c.phone2, f.phone2);
}
const { rows: contacts } = await live.query("select id, name, phone from public.customer_contacts");
const fakeContact = new Map();
contacts.forEach((c, i) => {
  const f = { name: `Test Contact ${i + 1}`, phone: c.phone ? fakePhone(`k${c.id}`) : c.phone };
  fakeContact.set(c.id, f);
  addName(c.name, f.name);
  if (c.phone) addPhone(c.phone, f.phone);
});
// Names typed elsewhere (who approved, who collected): swapped wherever they appear.
for (const [table, cols] of [["approval_requests", ["sent_to_name", "approver_name"]], ["quotations", ["sent_to_name", "approver_name", "removal_ack_name", "tint_ack_name"]], ["gate_outs", ["collector_name", "delivered_to"]], ["job_items", ["collector_name"]], ["jobs", ["brought_by"]], ["recovery_trips", ["contact_name"]]]) {
  const { rows } = await live.query(`select distinct unnest(array[${cols.map((c) => `"${c}"::text`).join(", ")}]) as v from public.${table}`);
  for (const r of rows) if (r.v && !nameSwaps.some(([re]) => { re.lastIndex = 0; return re.test(r.v); })) addName(r.v, `Test Person ${hashN(r.v, 1000)}`);
}
nameSwaps.sort((a, b) => b[0].source.length - a[0].source.length);

const scrub = (v) => {
  if (typeof v === "string") {
    let s = v;
    for (const [re, to] of nameSwaps) s = s.replace(re, to);
    for (const [re, to] of phoneSwaps) s = s.replace(re, to);
    return s;
  }
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object" && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
  return v;
};
const pinHash = (() => { const salt = crypto.randomBytes(16).toString("hex"); return `scrypt$${salt}$${crypto.scryptSync(TEST_PIN, salt, 32).toString("hex")}`; })();
const TEST_ADDRESS = "Test address, Al Quoz, Dubai";

/** Row by row: the named columns replaced, then every text anywhere scrubbed. */
function transform(table, row) {
  const r = { ...row };
  const set = (k, v) => { if (k in r && r[k] !== null && r[k] !== undefined && r[k] !== "") r[k] = v; };
  if (table === "customers") {
    const f = fakeCustomer.get(r.id);
    if (f) Object.assign(r, f);
    set("trn", `1000000000${String(hashN(r.id, 100000)).padStart(5, "0")}`);
  }
  if (table === "customer_contacts") Object.assign(r, fakeContact.get(r.id) ?? {});
  if (table === "staff_private") {
    set("email", `erp-test+${String(r.staff_id).slice(0, 8)}@example.com`);
    set("phone", fakePhone(`s${r.staff_id}`));
    set("pin_hash", pinHash);
  }
  if (table === "gate_ins") { set("location_address", TEST_ADDRESS); set("location_name", "Test location"); r.location_lat = null; r.location_lng = null; }
  if (table === "gate_outs") set("delivery_address", TEST_ADDRESS);
  if (table === "appointments") set("collect_address", TEST_ADDRESS);
  if (table === "recovery_trips") { set("location_details", TEST_ADDRESS); set("location_url", "https://maps.google.com/?q=25.1336,55.2306"); }
  if (table === "purchase_orders") set("emailed_to", "supplier@example.com");
  if (table === "inbound_scans") set("from_email", "scans@example.com");
  for (const k of Object.keys(r)) if (/phone/.test(k) && typeof r[k] === "string" && r[k] && !(table === "customers" || table === "customer_contacts" || table === "staff_private")) r[k] = fakePhone(`${table}.${k}.${r[k]}`);
  for (const k of Object.keys(r)) r[k] = scrub(r[k]);
  return r;
}

/* ---------- the copy ---------- */
const { rows: tableRows } = await live.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name");
const tables = tableRows.map((t) => t.table_name);
const { rows: testTables } = await test.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'");
const inTest = new Set(testTables.map((t) => t.table_name));
const missing = tables.filter((t) => !inTest.has(t));
if (missing.length) throw new Error(`The test database lacks tables (run npm run test:db:migrate first): ${missing.join(", ")}`);

await test.query("begin");
await test.query("set local session_replication_role = replica");
await test.query(`truncate table ${tables.map((t) => `public."${t}"`).join(", ")} restart identity cascade`);
const counts = [];
for (const t of tables) {
  if (SKIP.has(t)) continue;
  const { rows } = await live.query(`select * from public."${t}"`);
  if (!rows.length) continue;
  const { rows: cols } = await test.query("select column_name, is_generated, identity_generation from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position", [t]);
  const usable = cols.filter((c) => c.is_generated !== "ALWAYS").map((c) => c.column_name).filter((c) => c in rows[0]);
  const identity = cols.some((c) => c.identity_generation === "ALWAYS");
  const list = usable.map((c) => `"${c}"`).join(", ");
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400).map((r) => transform(t, r));
    await test.query(`insert into public."${t}" (${list}) ${identity ? "overriding system value " : ""}select ${list} from json_populate_recordset(null::public."${t}", $1::json)`, [JSON.stringify(chunk)]);
  }
  counts.push(`${t} ${rows.length}`);
}

// The database says it is the TEST copy; nothing reaches the real Zoho book; Clear test data is allowed here.
const settingsUpsert = async (key, value) => test.query("insert into public.settings (key, value, label) values ($1, $2::jsonb, $1) on conflict (key) do update set value = excluded.value", [key, JSON.stringify(value)]);
await settingsUpsert("database_role", "test");
await settingsUpsert("zoho_live_enabled", false);
await settingsUpsert("test_mode_enabled", true);
await test.query("delete from public.settings where key in ('zoho_went_live_at', 'scans_mailbox_last_check')");

// Number series continue from where live is (a test's numbers never look like a real document's next number).
const { rows: seqs } = await live.query("select sequencename, last_value from pg_sequences where schemaname = 'public' and last_value is not null");
for (const s of seqs) await test.query("select setval($1, $2)", [`public.${s.sequencename}`, s.last_value]).catch(() => null);
for (const t of ["job_events", "quotation_events"]) await test.query(`select setval(pg_get_serial_sequence('public.${t}', 'id'), greatest(1, coalesce((select max(id) from public.${t}), 1)))`);
await test.query("commit");

// A sign-in for every staff member on the test project (same id, made-up email), so the tests can log people in.
const { rows: staff } = await live.query("select id from public.staff");
let made = 0;
for (const s of staff) {
  const r = await fetch(`${testEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: testEnv.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${testEnv.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ id: s.id, email: `erp-test+${String(s.id).slice(0, 8)}@example.com`, email_confirm: true }),
  });
  if (r.ok) made++;
  else if (r.status !== 422) console.log(`sign-in for staff ${String(s.id).slice(0, 8)}: ${r.status} ${(await r.text()).slice(0, 120)}`);
}
await live.end();
await test.end();
console.log(`Copied: ${counts.join(" · ")}`);
console.log(`${fakeCustomer.size} customers and ${fakeContact.size} contacts made anonymous, ${nameSwaps.length} names and ${phoneSwaps.length} numbers replaced in every text; ${made} staff sign-ins created (PIN ${TEST_PIN} for everyone).`);
