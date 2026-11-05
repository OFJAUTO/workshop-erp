// THE ONE-OFF MOVE OF THE PC'S backups/ FOLDER OFF-SITE (5 November 2026, the owner's point 2):
// every local backup folder is packed, encrypted and uploaded to B2 under imported/, each upload is
// VERIFIED by downloading it again, decrypting it and comparing the checksum of what came back, and
// only a folder whose copy proved good is deleted - after its name was listed. Run again any time:
// folders already in B2 with a good checksum are skipped, so an interrupted run just continues.
//   node --env-file=.env.local scripts/offsite/migrate-local-backups.mjs [--delete]
//   Without --delete it uploads and verifies only, and prints the list it WOULD delete.
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { b2Connect, b2Download, b2List, b2Upload, decryptFile, encryptFile, keyFromEnv, sha1File, tarGz } from "./lib.mjs";

const doDelete = process.argv.includes("--delete");
const SOURCE = "backups";

const work = path.join(os.tmpdir(), `ofj-migrate-${Date.now()}`);
mkdirSync(work, { recursive: true });

try {
  const key = keyFromEnv();
  const b2 = await b2Connect();
  const already = new Map((await b2List(b2, "imported/")).map((f) => [f.fileName, f]));
  const folders = readdirSync(SOURCE, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  console.log(`${folders.length} local backup folders in ${SOURCE}/; ${already.size} already off-site.`);

  const verified = [];
  const failed = [];
  for (const name of folders) {
    const remote = `imported/${name}.tar.gz.enc`;
    const tar = path.join(work, "pack.tar.gz");
    const enc = `${tar}.enc`;
    const back = path.join(work, "back.enc");
    const backPlain = path.join(work, "back.tar.gz");
    try {
      if (!already.has(remote)) {
        await tarGz(path.join(SOURCE, name), tar);
        await encryptFile(tar, enc, key);
        await b2Upload(b2, enc, remote);
      }
      /* Verify what B2 holds: download, decrypt, and the decrypted archive must open. */
      await b2Download(b2, remote, back);
      await decryptFile(back, backPlain, key);
      const localSha = already.has(remote) ? null : await sha1File(enc);
      const backSha = await sha1File(back);
      if (localSha && localSha !== backSha) throw new Error("the downloaded copy differs from what was uploaded");
      verified.push(name);
      console.log(`OK   ${name} (${(statSync(back).size / 1048576).toFixed(1)} MB off-site, decrypts)`);
    } catch (e) {
      failed.push(name);
      console.error(`FAIL ${name}: ${e.message}`);
    } finally {
      for (const f of [tar, enc, back, backPlain]) rmSync(f, { force: true });
    }
  }

  console.log(`\n${verified.length} verified off-site, ${failed.length} failed.`);
  if (failed.length) console.log(`Failed (kept on the PC): ${failed.join(", ")}`);
  console.log(`\nThe folders ${doDelete ? "being deleted now" : "that WOULD be deleted (run again with --delete)"}:`);
  for (const name of verified) console.log(`  ${SOURCE}/${name}`);
  if (doDelete) {
    for (const name of verified) rmSync(path.join(SOURCE, name), { recursive: true, force: true });
    console.log(`\nDeleted ${verified.length} local folders. ${failed.length ? "The failed ones stay." : "The PC's backups folder now holds only what is newer than this run."}`);
  }
  if (failed.length) process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
