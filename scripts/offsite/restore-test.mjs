// THE MONTHLY RESTORE TEST (5 November 2026): proves the off-site copies actually restore. The newest
// nightly copy is downloaded from B2, decrypted, unpacked and restored INTO THE TEST PROJECT - into
// its own scratch schema (restore_check), so the test data the browser suites use is never touched
// and no real customer detail lands in the test app. Every table's row count is checked against the
// dump's manifest, a few known records are checked by name, the scratch schema is dropped, and the
// report lands on the heartbeat row the owner sees in Settings > Background jobs.
//   GitHub Actions: .github/workflows/offsite-restore-test.yml
//   On the PC:  node --env-file=.env.local scripts/offsite/restore-test.mjs
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { b2Connect, b2Download, b2List, connectLive, connectTest, decryptFile, heartbeat, keyFromEnv, unTarGz } from "./lib.mjs";

const work = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), `ofj-restore-${Date.now()}`);
mkdirSync(work, { recursive: true });

let test = null;
let live = null;
try {
  const key = keyFromEnv();

  /* 1. The newest nightly copy, down and open. */
  const b2 = await b2Connect();
  const dailies = (await b2List(b2, "db/daily/ofj-db-")).map((f) => f.fileName).sort();
  if (!dailies.length) throw new Error("No nightly copy in B2 yet.");
  const newest = dailies[dailies.length - 1];
  console.log(`Restoring ${newest}…`);
  const enc = path.join(work, "copy.enc");
  await b2Download(b2, newest, enc);
  const tar = path.join(work, "copy.tar.gz");
  await decryptFile(enc, tar, key);
  const dump = path.join(work, "dump");
  mkdirSync(dump, { recursive: true });
  await unTarGz(tar, dump);
  const manifest = JSON.parse(readFileSync(path.join(dump, "_manifest.json"), "utf8"));

  /* 2. Into the TEST project's scratch schema - never its real tables. */
  test = await connectTest();
  await test.query("drop schema if exists restore_check cascade");
  await test.query("create schema restore_check");
  const files = readdirSync(dump).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  let inserted = 0;
  const problems = [];
  for (const f of files) {
    const table = path.basename(f, ".json");
    const rows = JSON.parse(readFileSync(path.join(dump, f), "utf8"));
    // LIKE without options copies columns and not-nulls only: identity and generated columns become
    // plain columns, so the dumped values insert exactly; no triggers, no policies, no foreign keys.
    await test.query(`create table restore_check."${table}" (like public."${table}")`);
    if (rows.length) {
      const { rows: cols } = await test.query("select column_name, data_type from information_schema.columns where table_schema = 'restore_check' and table_name = $1", [table]);
      const typeOf = new Map(cols.map((c) => [c.column_name, c.data_type]));
      const columns = Object.keys(rows[0]);
      const quoted = columns.map((c) => `"${c}"`).join(", ");
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const values = [];
        const params = [];
        for (const r of chunk) {
          const ph = [];
          for (const c of columns) {
            const t = typeOf.get(c) ?? "";
            let v = r[c];
            if (v !== null && v !== undefined && (t === "jsonb" || t === "json")) v = JSON.stringify(v);
            params.push(v);
            ph.push(`$${params.length}${t === "jsonb" ? "::jsonb" : t === "json" ? "::json" : t === "ARRAY" ? "" : ""}`);
          }
          values.push(`(${ph.join(", ")})`);
        }
        await test.query(`insert into restore_check."${table}" (${quoted}) values ${values.join(", ")}`, params);
      }
    }
    const { rows: [{ n }] } = await test.query(`select count(*)::int as n from restore_check."${table}"`);
    inserted += n;
    const expected = manifest.tables[table] ?? 0;
    if (n !== expected) problems.push(`${table}: dump ${expected}, restored ${n}`);
  }

  /* 3. Known records, by name. */
  const { rows: [job] } = await test.query(`select job_number from restore_check.jobs order by created_at desc limit 1`).catch(() => ({ rows: [{}] }));
  const { rows: [cust] } = await test.query(`select count(*)::int as n from restore_check.customers`);
  const { rows: [sett] } = await test.query(`select count(*)::int as n from restore_check.settings where key = 'labour_rate_aed'`);
  if (!job?.job_number) problems.push("no newest job found");
  if (!cust?.n) problems.push("no customers restored");
  if (!sett?.n) problems.push("the labour rate setting is missing");

  /* 4. The three money tables against LIVE today (read-only counts). A difference is normal when
     work happened since the copy was taken; it is reported, never a failure. */
  const COMPARE = ["jobs", "invoices", "payments"];
  const restoredCounts = {};
  for (const t of COMPARE) {
    const { rows: [r] } = await test.query(`select count(*)::int as n from restore_check."${t}"`).catch(() => ({ rows: [{ n: null }] }));
    restoredCounts[t] = r?.n ?? null;
  }
  await test.query("drop schema restore_check cascade");
  const liveRead = await connectLive();
  const liveCounts = {};
  try {
    await liveRead.query("set session characteristics as transaction read only");
    for (const t of COMPARE) {
      const { rows: [r] } = await liveRead.query(`select count(*)::int as n from public."${t}"`);
      liveCounts[t] = r.n;
    }
  } finally { await liveRead.end(); }
  const compareWords = COMPARE.map((t) => `${t} ${restoredCounts[t]} restored / ${liveCounts[t]} live now`).join(", ");
  console.log(`Compared with live: ${compareWords}`);
  const fp = createHash("sha256").update((process.env.BACKUP_ENCRYPTION_KEY ?? "").trim()).digest("hex").slice(0, 8);
  console.log(`Encryption key fingerprint (first 8 of its sha256, not the key): ${fp}`);

  const ok = problems.length === 0;
  const words = ok
    ? `Restored ${path.basename(newest)} into the test project: ${files.length} tables, ${inserted} rows, every count matches; newest job ${job.job_number}, ${cust.n} customers; ${compareWords}`
    : `RESTORE PROBLEMS on ${path.basename(newest)}: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ""}`;
  console.log(words);

  live = await connectLive();
  await heartbeat(live, "offsite_restore", ok, words);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error(`RESTORE TEST FAILED: ${e.message}`);
  try {
    await test?.query("drop schema if exists restore_check cascade");
    if (!live) live = await connectLive();
    await heartbeat(live, "offsite_restore", false, `FAILED: ${e.message}`);
  } catch {}
  process.exitCode = 1;
} finally {
  await test?.end().catch(() => {});
  await live?.end().catch(() => {});
  rmSync(work, { recursive: true, force: true });
}
