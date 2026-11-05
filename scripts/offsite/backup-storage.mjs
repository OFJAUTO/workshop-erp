// THE WEEKLY OFF-SITE STORAGE COPY (5 November 2026): every photo, video and PDF in the Supabase
// storage buckets, copied INCREMENTALLY (only new or changed files) to the owner's B2 bucket, each
// file encrypted. The listing comes from the live database (read-only); the files come over the
// storage API (service key). A manifest in B2 remembers what is already there, so a weekly run after
// the first big one moves only the week's new files. Files deleted in the app stay in the backup.
//   GitHub Actions: .github/workflows/offsite-storage.yml
//   On the PC:  node --env-file=.env.local scripts/offsite/backup-storage.mjs [--limit 25]
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import { b2Connect, b2Download, b2Upload, connectLive, decryptFile, encryptFile, heartbeat, keyFromEnv } from "./lib.mjs";

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity; // for a careful first run
const MANIFEST = "storage/manifest.json.enc";

const work = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), `ofj-storage-${Date.now()}`);
mkdirSync(work, { recursive: true });

let live = null;
try {
  const key = keyFromEnv();
  const supabaseUrl = (process.env.LIVE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const serviceKey = process.env.LIVE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey) throw new Error("The storage address or service key is not set.");

  live = await connectLive();
  await live.query("set default_transaction_read_only = on");
  const { rows: objects } = await live.query(
    `select bucket_id, name, coalesce((metadata->>'size')::bigint, 0) as size, coalesce(metadata->>'eTag', '') as etag
     from storage.objects order by bucket_id, name`,
  );
  console.log(`${objects.length} files in storage.`);

  /* The manifest of what B2 already holds (encrypted like everything else). */
  const b2 = await b2Connect();
  let manifest = {};
  try {
    const encM = path.join(work, "manifest.enc");
    await b2Download(b2, MANIFEST, encM);
    const plainM = path.join(work, "manifest.json");
    await decryptFile(encM, plainM, key);
    manifest = JSON.parse(readFileSync(plainM, "utf8"));
  } catch {
    console.log("No manifest yet - this is the first storage copy.");
  }

  const todo = objects.filter((o) => {
    const have = manifest[`${o.bucket_id}/${o.name}`];
    return !have || have.etag !== o.etag || Number(have.size) !== Number(o.size);
  });
  console.log(`${todo.length} new or changed files to copy${Number.isFinite(LIMIT) ? ` (limited to ${LIMIT} this run)` : ""}.`);

  let copied = 0;
  let bytes = 0;
  let failed = 0;
  for (const o of todo.slice(0, LIMIT)) {
    const local = path.join(work, "f.bin");
    const localEnc = path.join(work, "f.bin.enc");
    try {
      const r = await fetch(`${supabaseUrl}/storage/v1/object/${o.bucket_id}/${o.name.split("/").map(encodeURIComponent).join("/")}`, { headers: { Authorization: `Bearer ${serviceKey}` } });
      if (!r.ok) throw new Error(`download ${r.status}`);
      await pipeline(r.body, createWriteStream(local));
      await encryptFile(local, localEnc, key);
      await b2Upload(b2, localEnc, `storage/${o.bucket_id}/${o.name}.enc`);
      manifest[`${o.bucket_id}/${o.name}`] = { size: Number(o.size), etag: o.etag };
      copied++;
      bytes += Number(o.size);
      if (copied % 25 === 0) console.log(`${copied} copied…`);
    } catch (e) {
      failed++;
      console.error(`SKIPPED ${o.bucket_id}/${o.name}: ${e.message}`);
    } finally {
      rmSync(local, { force: true });
      rmSync(localEnc, { force: true });
    }
  }

  /* Store the manifest back (also when nothing changed, so the first run always writes one). */
  const plainOut = path.join(work, "manifest-out.json");
  const encOut = `${plainOut}.enc`;
  writeFileSync(plainOut, JSON.stringify(manifest), "utf8");
  await encryptFile(plainOut, encOut, key);
  await b2Upload(b2, encOut, MANIFEST);

  const words = `${copied} of ${todo.length} new/changed files copied (${(bytes / 1048576).toFixed(1)} MB)${failed ? `, ${failed} FAILED` : ""}; ${Object.keys(manifest).length} files held off-site`;
  await live.query("set default_transaction_read_only = off");
  await heartbeat(live, "offsite_storage", failed === 0, words);
  console.log(words);
  if (failed || (todo.length > LIMIT && Number.isFinite(LIMIT))) process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error(`STORAGE COPY FAILED: ${e.message}`);
  try {
    if (!live) live = await connectLive();
    else await live.query("set default_transaction_read_only = off");
    await heartbeat(live, "offsite_storage", false, `FAILED: ${e.message}`);
  } catch {}
  process.exitCode = 1;
} finally {
  await live?.end().catch(() => {});
  rmSync(work, { recursive: true, force: true });
}
