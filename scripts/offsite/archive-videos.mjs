// THE MONTHLY VIDEO ARCHIVE (9 November 2026, Section 7): gate-in and inspection videos stay in Supabase for 12 months
// after the car leaves (settings.video_archive_months, the owner can change it), then move to the Backblaze archive
// ONLY - each file encrypted with the backup key, checked after upload, and only then taken out of Supabase. The row
// keeps archived_at and archive_key, so the video is still retrievable: scripts/offsite/restore-video.mjs <archive_key>.
//   GitHub Actions: .github/workflows/offsite-video-archive.yml (never from the PC)
//   Dry run (lists what would move, changes nothing):  node archive-videos.mjs --dry-run
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { b2Connect, b2Upload, connectLive, encryptFile, heartbeat, keyFromEnv } from "./lib.mjs";

const DRY = process.argv.includes("--dry-run");
const work = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), `ofj-video-archive-${Date.now()}`);
mkdirSync(work, { recursive: true });
const VIDEO = "(storage_path ilike '%.mov' or storage_path ilike '%.mp4' or storage_path ilike '%.webm')";

let live = null;
let moved = 0;
try {
  const supabaseUrl = (process.env.LIVE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const serviceKey = process.env.LIVE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey) throw new Error("The storage address or service key is not set.");
  live = await connectLive();
  // Before the database change of 9 November is applied there is nowhere to remember an archived video: wait quietly.
  const { rows: ready } = await live.query("select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gate_in_media' and column_name = 'archived_at'");
  if (!ready.length) {
    console.log("Waiting for the database change of 9 November (archived_at): nothing moved.");
    process.exit(0);
  }
  const { rows: setting } = await live.query("select value from public.settings where key = 'video_archive_months'");
  const months = Math.max(1, Number(setting[0]?.value ?? 12) || 12);
  const due = await live.query(
    `select 'gate_in_media' as tbl, m.id, 'gate-in-media' as bucket, m.storage_path from public.gate_in_media m join public.jobs j on j.id = m.job_id
      where m.archived_at is null and ${VIDEO.replaceAll("storage_path", "m.storage_path")} and j.gated_out_at < now() - make_interval(months => $1)
     union all
     select 'inspection_media', m.id, 'inspection-media', m.storage_path from public.inspection_media m join public.inspections i on i.id = m.inspection_id join public.jobs j on j.id = i.job_id
      where m.archived_at is null and ${VIDEO.replaceAll("storage_path", "m.storage_path")} and j.gated_out_at < now() - make_interval(months => $1)
     limit 2000`,
    [months],
  );
  console.log(`${due.rows.length} video(s) older than ${months} months after the car left.`);
  if (DRY) {
    for (const r of due.rows.slice(0, 20)) console.log(" ", r.bucket, r.storage_path);
  } else if (due.rows.length) {
    const key = keyFromEnv();
    const b2 = await b2Connect();
    for (const r of due.rows) {
      const plain = path.join(work, "plain");
      const enc = path.join(work, "enc");
      const res = await fetch(`${supabaseUrl}/storage/v1/object/${r.bucket}/${r.storage_path}`, { headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey } });
      if (!res.ok) { console.log("skip (cannot read):", r.storage_path, res.status); continue; }
      writeFileSync(plain, Buffer.from(await res.arrayBuffer()));
      await encryptFile(plain, enc, key);
      const archiveKey = `archive/videos/${r.bucket}/${r.storage_path}.enc`;
      await b2Upload(b2, enc, archiveKey); // checked by its sha1 inside b2Upload
      // Only after the archive holds it: out of Supabase, and the row remembers where it went.
      const del = await fetch(`${supabaseUrl}/storage/v1/object/${r.bucket}`, { method: "DELETE", headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "content-type": "application/json" }, body: JSON.stringify({ prefixes: [r.storage_path] }) });
      if (!del.ok) { console.log("archived but not removed from Supabase:", r.storage_path, del.status); continue; }
      await live.query(`update public.${r.tbl} set archived_at = now(), archive_key = $2 where id = $1`, [r.id, archiveKey]);
      moved++;
      rmSync(plain, { force: true });
      rmSync(enc, { force: true });
    }
  }
  await heartbeat(live, "offsite_video_archive", true, DRY ? `Dry run: ${due.rows.length} due` : `${moved} video${moved === 1 ? "" : "s"} moved to the archive`);
  console.log(DRY ? "Dry run: nothing changed." : `${moved} moved.`);
} catch (e) {
  console.error(e);
  if (live) await heartbeat(live, "offsite_video_archive", false, String(e?.message ?? e).slice(0, 300)).catch(() => null);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
  await live?.end().catch(() => null);
}
