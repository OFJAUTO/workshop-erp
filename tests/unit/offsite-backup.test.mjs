// Off-site backups (5 November 2026): the encryption roundtrip, tamper detection, a wrong key
// refused, and the retention rule that keeps 30 dailies and 12 monthlies.
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { decryptFile, encryptFile, toPrune } from "../../scripts/offsite/lib.mjs";

let passed = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log(`OK   ${name}`); }, (e) => { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; });

const dir = mkdtempSync(path.join(os.tmpdir(), "ofj-offsite-"));
const key = randomBytes(32);
const plain = path.join(dir, "plain.bin");
const enc = path.join(dir, "plain.enc");
const back = path.join(dir, "back.bin");
const payload = Buffer.concat([Buffer.from("OFJ backup test "), randomBytes(512 * 1024)]);
writeFileSync(plain, payload);

await check("a file encrypts and decrypts back to the exact bytes", async () => {
  await encryptFile(plain, enc, key);
  assert.notDeepEqual(readFileSync(enc).subarray(20, 60), payload.subarray(0, 40), "the stored file must not hold the plain bytes");
  await decryptFile(enc, back, key);
  assert.ok(readFileSync(back).equals(payload));
});

await check("a tampered copy is refused, never silently wrong", async () => {
  const bytes = readFileSync(enc);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  const bad = path.join(dir, "tampered.enc");
  writeFileSync(bad, bytes);
  await assert.rejects(() => decryptFile(bad, path.join(dir, "bad.bin"), key));
});

await check("the wrong key is refused", async () => {
  await assert.rejects(() => decryptFile(enc, path.join(dir, "wrong.bin"), randomBytes(32)));
});

await check("a file that is not ours is refused in plain words", async () => {
  const notOurs = path.join(dir, "notours.enc");
  writeFileSync(notOurs, randomBytes(4096));
  await assert.rejects(() => decryptFile(notOurs, path.join(dir, "x.bin"), key), /Not an OFJ backup file/);
});

await check("retention keeps the newest 30 dailies and the newest 12 monthlies", () => {
  const dailies = Array.from({ length: 35 }, (_, i) => `db/daily/ofj-db-2026-10-${String(i + 1).padStart(2, "0")}T00-30-00.tar.gz.enc`);
  const prune = toPrune([...dailies, "db/monthly/ofj-db-2026-10.tar.gz.enc", "storage/manifest.json.enc"], "db/daily/ofj-db-", 30);
  assert.equal(prune.length, 5);
  assert.ok(prune.every((n) => n < "db/daily/ofj-db-2026-10-06"), "only the OLDEST go");
  assert.equal(toPrune(dailies.slice(0, 12), "db/daily/ofj-db-", 30).length, 0, "fewer than the keep count deletes nothing");
  const monthlies = Array.from({ length: 14 }, (_, i) => `db/monthly/ofj-db-2025-${String(i + 1).padStart(2, "0")}.tar.gz.enc`);
  assert.equal(toPrune(monthlies, "db/monthly/ofj-db-", 12).length, 2);
});

rmSync(dir, { recursive: true, force: true });
console.log(process.exitCode ? "Some offsite checks failed" : `All passed (${passed})`);
