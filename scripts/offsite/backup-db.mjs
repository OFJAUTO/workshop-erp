// THE NIGHTLY OFF-SITE DATABASE BACKUP (5 November 2026). Dumps every public table from the LIVE
// database (the connection is read-only for the whole run), packs and ENCRYPTS it, uploads it to the
// owner's Backblaze B2 bucket, keeps 30 daily and 12 monthly copies, and writes the heartbeat row the
// ERP's Settings > Background jobs watches (late or failed = the owner's bell).
//   GitHub Actions (scheduled - never from the PC): .github/workflows/offsite-backup.yml
//   On the PC:  node --env-file=.env.local scripts/offsite/backup-db.mjs [--dry-run]
//   --dry-run: no B2 and no heartbeat; instead the encrypted file is decrypted again and every table's
//   row count is checked against the dump - the full roundtrip proven locally.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { b2Connect, b2Delete, b2List, b2Upload, connectLive, decryptFile, encryptFile, heartbeat, keyFromEnv, tarGz, toPrune, unTarGz } from "./lib.mjs";

const dryRun = process.argv.includes("--dry-run");
const KEEP_DAILY = 30;
const KEEP_MONTHLY = 12;

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const work = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), `ofj-backup-${stamp}`);
const dumpDir = path.join(work, "dump");
mkdirSync(dumpDir, { recursive: true });

let live = null;
try {
  const key = keyFromEnv();
  live = await connectLive();
  await live.query("set default_transaction_read_only = on");

  /* 1. Dump every table (same shape as scripts/db-backup.mjs, so scripts/db-restore.mjs reads it). */
  const { rows: tables } = await live.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name");
  const counts = {};
  let total = 0;
  for (const { table_name } of tables) {
    const { rows } = await live.query(`select * from public."${table_name}"`);
    writeFileSync(path.join(dumpDir, `${table_name}.json`), JSON.stringify(rows), "utf8");
    counts[table_name] = rows.length;
    total += rows.length;
  }
  writeFileSync(path.join(dumpDir, "_manifest.json"), JSON.stringify({ stamp, tables: counts, total }, null, 2), "utf8");
  const { rows: settings } = await live.query("select key, value from public.settings order by key");
  writeFileSync(path.join(dumpDir, "_settings-readable.json"), JSON.stringify(Object.fromEntries(settings.map((s) => [s.key, s.value])), null, 2), "utf8");
  console.log(`Dumped ${tables.length} tables, ${total} rows.`);

  /* 2. Pack and encrypt. */
  const tarFile = path.join(work, `ofj-db-${stamp}.tar.gz`);
  await tarGz(dumpDir, tarFile);
  const encFile = `${tarFile}.enc`;
  await encryptFile(tarFile, encFile, key);
  const mb = (statSync(encFile).size / 1048576).toFixed(1);
  console.log(`Encrypted: ${path.basename(encFile)} (${mb} MB).`);

  if (dryRun) {
    /* The local proof: decrypt, unpack, and check every count against the dump. */
    const back = path.join(work, "roundtrip");
    mkdirSync(back, { recursive: true });
    const plain = path.join(work, "roundtrip.tar.gz");
    await decryptFile(encFile, plain, key);
    await unTarGz(plain, back);
    const manifest = JSON.parse(readFileSync(path.join(back, "_manifest.json"), "utf8"));
    let bad = 0;
    for (const [table, n] of Object.entries(manifest.tables)) {
      const rows = JSON.parse(readFileSync(path.join(back, `${table}.json`), "utf8"));
      if (rows.length !== n) {
        console.error(`ROUNDTRIP MISMATCH ${table}: dump ${n}, decrypted ${rows.length}`);
        bad++;
      }
    }
    const files = readdirSync(back).filter((f) => f.endsWith(".json") && !f.startsWith("_")).length;
    console.log(bad ? `DRY RUN FAILED: ${bad} tables differ.` : `DRY RUN OK: ${files} tables decrypt and match the dump exactly (${total} rows).`);
    process.exit(bad ? 1 : 0);
  }

  /* 3. Upload: the daily copy, and the month's copy when this month has none yet. */
  const b2 = await b2Connect();
  const daily = await b2Upload(b2, encFile, `db/daily/ofj-db-${stamp}.tar.gz.enc`);
  console.log(`Uploaded ${daily.fileName}.`);
  const month = stamp.slice(0, 7);
  const monthlies = await b2List(b2, "db/monthly/");
  let monthlyNote = "";
  if (!monthlies.some((f) => f.fileName.startsWith(`db/monthly/ofj-db-${month}`))) {
    const m = await b2Upload(b2, encFile, `db/monthly/ofj-db-${month}-${stamp.slice(8)}.tar.gz.enc`);
    monthlyNote = ` + the ${month} monthly copy`;
    console.log(`Uploaded ${m.fileName}.`);
  }

  /* 4. Retention: newest 30 dailies, newest 12 monthlies. */
  const dailies = await b2List(b2, "db/daily/");
  for (const name of toPrune(dailies.map((f) => f.fileName), "db/daily/ofj-db-", KEEP_DAILY)) {
    const f = dailies.find((x) => x.fileName === name);
    await b2Delete(b2, f.fileName, f.fileId);
    console.log(`Pruned ${f.fileName}.`);
  }
  const monthliesNow = await b2List(b2, "db/monthly/");
  for (const name of toPrune(monthliesNow.map((f) => f.fileName), "db/monthly/ofj-db-", KEEP_MONTHLY)) {
    const f = monthliesNow.find((x) => x.fileName === name);
    await b2Delete(b2, f.fileName, f.fileId);
    console.log(`Pruned ${f.fileName}.`);
  }

  /* 5. The heartbeat the ERP watches (the dump's read-only setting comes off for this one write). */
  const kept = (await b2List(b2, "db/daily/")).length;
  await live.query("set default_transaction_read_only = off");
  await heartbeat(live, "offsite_backup", true, `${tables.length} tables, ${total} rows, ${mb} MB encrypted${monthlyNote}; ${kept} daily copies held`);
  console.log("Done.");
} catch (e) {
  console.error(`BACKUP FAILED: ${e.message}`);
  try {
    if (!dryRun) {
      if (!live) live = await connectLive();
      else await live.query("set default_transaction_read_only = off");
      await heartbeat(live, "offsite_backup", false, `FAILED: ${e.message}`);
    }
  } catch {}
  process.exitCode = 1;
} finally {
  await live?.end().catch(() => {});
  rmSync(work, { recursive: true, force: true });
}
