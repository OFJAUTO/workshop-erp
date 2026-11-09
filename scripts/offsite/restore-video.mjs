// BRING AN ARCHIVED VIDEO BACK (9 November 2026, Section 7): from the Backblaze archive into Supabase at its old place,
// and the row is marked not archived again (the app shows it as before). Run by the owner or from GitHub by hand.
//   node --env-file=.env.local scripts/offsite/restore-video.mjs <archive_key>
//   (needs B2_KEY_ID, B2_APP_KEY, B2_BUCKET and BACKUP_ENCRYPTION_KEY; the archive_key is on the video's row)
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { b2Connect, b2Download, connectLive, decryptFile, keyFromEnv } from "./lib.mjs";

const archiveKey = process.argv[2];
if (!archiveKey || !archiveKey.startsWith("archive/videos/")) {
  console.error("Usage: restore-video.mjs archive/videos/<bucket>/<path>.enc");
  process.exit(1);
}
const [, , bucket, ...rest] = archiveKey.split("/");
const storagePath = rest.join("/").replace(/\.enc$/, "");
const work = path.join(os.tmpdir(), `ofj-video-restore-${Date.now()}`);
mkdirSync(work, { recursive: true });
let live = null;
try {
  const supabaseUrl = (process.env.LIVE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const serviceKey = process.env.LIVE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const b2 = await b2Connect();
  const enc = path.join(work, "enc");
  const plain = path.join(work, "plain");
  await b2Download(b2, archiveKey, enc);
  await decryptFile(enc, plain, keyFromEnv());
  const ext = storagePath.split(".").pop()?.toLowerCase();
  const type = ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : "video/mp4";
  const up = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${storagePath}`, { method: "POST", headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "content-type": type, "x-upsert": "true" }, body: readFileSync(plain) });
  if (!up.ok) throw new Error(`Could not put it back: ${up.status} ${await up.text()}`);
  live = await connectLive();
  const tbl = bucket === "inspection-media" ? "inspection_media" : "gate_in_media";
  await live.query(`update public.${tbl} set archived_at = null where archive_key = $1`, [archiveKey]);
  console.log(`Back in the app: ${bucket}/${storagePath}`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
  await live?.end().catch(() => null);
}
