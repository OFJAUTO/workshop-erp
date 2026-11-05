// Shared pieces of the OFF-SITE BACKUPS (5 November 2026, the owner's approval "approve backups"):
// the database connections (the pooler address on GitHub's runners, the direct host on the PC), the
// Backblaze B2 client (plain fetch, no new dependency), AES-256-GCM file encryption, the tar step,
// the retention rule and the heartbeat row the ERP's Settings > Background jobs watches.
// NOTHING here ever prints a secret.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, statSync, openSync, readSync, closeSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import pg from "pg";

/* ---------------- database connections ---------------- */

/** LIVE: prefers LIVE_DB_URL (the pooler, for GitHub's runners - the direct db.<ref> host answers on
 * IPv6 only, which the runners do not have), else derives the direct host from the PC's .env.local. */
export async function connectLive() {
  return connect(process.env.LIVE_DB_URL, process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_DB_PASSWORD);
}
/** TEST: prefers TEST_DB_URL, else needs TEST_SUPABASE_URL + TEST_DB_PASSWORD. */
export async function connectTest() {
  return connect(process.env.TEST_DB_URL, process.env.TEST_SUPABASE_URL, process.env.TEST_DB_PASSWORD);
}
async function connect(dbUrl, supabaseUrl, password) {
  const client = dbUrl
    ? new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
    : new pg.Client({ host: `db.${refOf(supabaseUrl)}.supabase.co`, port: 5432, user: "postgres", password, database: "postgres", ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}
export const refOf = (url) => (url ?? "").replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");

/* ---------------- the heartbeat the ERP watches ---------------- */

/** Mirrors src/lib/background-jobs.ts recordJobRun: the Settings box shows the run, and the ERP's
 * lateness check bells the owner when a job has not run on time or recorded a failure. */
export async function heartbeat(liveClient, key, ok, words) {
  try {
    const now = new Date().toISOString();
    await liveClient.query(
      `update public.background_jobs set last_ran_at = $2, last_ok = $3, last_result = $4, late_notified_at = null, updated_at = $2 where key = $1`,
      [key, now, ok, String(words).slice(0, 300)],
    );
  } catch (e) {
    console.error(`heartbeat ${key}: ${e.message}`); // never fail the backup over the heartbeat
  }
}

/* ---------------- AES-256-GCM files ---------------- */

const MAGIC = Buffer.from("OFJB2601"); // 8 bytes, then 12-byte IV, ciphertext, 16-byte tag at the end

export function keyFromEnv() {
  const hex = (process.env.BACKUP_ENCRYPTION_KEY ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("BACKUP_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Not printing what was given.");
  return Buffer.from(hex, "hex");
}

export async function encryptFile(src, dest, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = createWriteStream(dest);
  out.write(MAGIC);
  out.write(iv);
  await pipeline(createReadStream(src), cipher, out, { end: false });
  await new Promise((res, rej) => out.end(cipher.getAuthTag(), (e) => (e ? rej(e) : res())));
  return dest;
}

export async function decryptFile(src, dest, key) {
  const size = statSync(src).size;
  if (size < MAGIC.length + 12 + 16) throw new Error("Not an OFJ backup file (too small).");
  const fd = openSync(src, "r");
  const head = Buffer.alloc(MAGIC.length + 12);
  const tag = Buffer.alloc(16);
  try {
    readSync(fd, head, 0, head.length, 0);
    readSync(fd, tag, 0, 16, size - 16);
  } finally {
    closeSync(fd);
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not an OFJ backup file (wrong header).");
  const decipher = createDecipheriv("aes-256-gcm", key, head.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(src, { start: head.length, end: size - 17 }), decipher, createWriteStream(dest));
  return dest;
}

export async function sha1File(file) {
  const h = createHash("sha1");
  await pipeline(createReadStream(file), h);
  return h.digest("hex");
}

/* ---------------- tar ---------------- */

/** tar.gz a folder's CONTENTS. GNU tar on Windows reads any "C:\…" argument as a remote host, so the
 * archive is named RELATIVE to its own folder and directories go in as /c/… (a no-op on Linux). */
const tarPath = (p) => (process.platform === "win32" ? "/" + p[0].toLowerCase() + p.slice(2).replaceAll("\\", "/") : p);
export async function tarGz(folder, dest) {
  await run("tar", ["-czf", path.basename(dest), "-C", tarPath(folder), "."], path.dirname(dest));
  return dest;
}
export async function unTarGz(archive, intoFolder) {
  await run("tar", ["-xzf", path.basename(archive), "-C", tarPath(intoFolder)], path.dirname(archive));
}
function run(cmd, args, cwd) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"], cwd });
    p.on("error", rej);
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
  });
}

/* ---------------- retention (pure - unit tested) ---------------- */

/** Which stored copies to DELETE: keep the newest `keep` of the names that match the prefix; names
 * sort by their stamp (ofj-db-2026-11-05T00-30-00.tar.gz.enc), so a plain sort is newest-last. */
export function toPrune(names, prefix, keep) {
  const mine = names.filter((n) => n.startsWith(prefix)).sort();
  return mine.slice(0, Math.max(0, mine.length - keep));
}

/* ---------------- Backblaze B2 (native API over fetch) ---------------- */

export async function b2Connect() {
  const keyId = need("B2_KEY_ID");
  const appKey = need("B2_APP_KEY");
  const bucketName = need("B2_BUCKET");
  const auth = await b2Json("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", { headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${appKey}`).toString("base64")}` } });
  // A key restricted to one bucket carries its bucketId in the allowance; otherwise look it up.
  let bucketId = auth.allowed?.bucketId ?? null;
  if (!bucketId) {
    const list = await b2Json(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, { method: "POST", headers: { Authorization: auth.authorizationToken }, body: JSON.stringify({ accountId: auth.accountId, bucketName }) });
    bucketId = list.buckets?.[0]?.bucketId;
  }
  if (!bucketId) throw new Error(`Bucket "${bucketName}" was not found with this key.`);
  return { apiUrl: auth.apiUrl, downloadUrl: auth.downloadUrl, token: auth.authorizationToken, bucketId, bucketName };
}
const need = (name) => {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`${name} is not set.`);
  return v;
};

async function b2Json(url, init, tries = 3) {
  for (let i = 1; ; i++) {
    const r = await fetch(url, init);
    if (r.ok) return r.json();
    const body = await r.text().catch(() => "");
    if (i >= tries || (r.status < 500 && r.status !== 429)) throw new Error(`B2 ${r.status} on ${url.split("/b2api")[1] ?? url}: ${body.slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 1500 * i));
  }
}

/** Upload one file; B2's contract is to fetch a fresh upload URL and retry on any upload failure. */
export async function b2Upload(b2, localFile, remoteName, tries = 4) {
  const sha1 = await sha1File(localFile);
  const size = statSync(localFile).size;
  for (let i = 1; ; i++) {
    try {
      const slot = await b2Json(`${b2.apiUrl}/b2api/v2/b2_get_upload_url`, { method: "POST", headers: { Authorization: b2.token }, body: JSON.stringify({ bucketId: b2.bucketId }) });
      const r = await fetch(slot.uploadUrl, {
        method: "POST",
        headers: {
          Authorization: slot.authorizationToken,
          "X-Bz-File-Name": encodeURIComponent(remoteName).replace(/%2F/g, "/"),
          "Content-Type": "b2/x-auto",
          "Content-Length": String(size),
          "X-Bz-Content-Sha1": sha1,
        },
        body: createReadStream(localFile),
        duplex: "half",
      });
      if (!r.ok) throw new Error(`upload ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
      const out = await r.json();
      if (out.contentSha1 !== sha1) throw new Error("B2 stored a different checksum.");
      return { fileId: out.fileId, fileName: out.fileName, size, sha1 };
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 2000 * i));
    }
  }
}

/** Every stored name under a prefix (paged). */
export async function b2List(b2, prefix) {
  const out = [];
  let startFileName;
  for (;;) {
    const page = await b2Json(`${b2.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: "POST",
      headers: { Authorization: b2.token },
      body: JSON.stringify({ bucketId: b2.bucketId, prefix, maxFileCount: 1000, ...(startFileName ? { startFileName } : {}) }),
    });
    for (const f of page.files ?? []) out.push({ fileName: f.fileName, fileId: f.fileId, size: f.contentLength, sha1: f.contentSha1, uploaded: f.uploadTimestamp });
    if (!page.nextFileName) return out;
    startFileName = page.nextFileName;
  }
}

export async function b2Download(b2, remoteName, localFile) {
  const r = await fetch(`${b2.downloadUrl}/file/${b2.bucketName}/${encodeURIComponent(remoteName).replace(/%2F/g, "/")}`, { headers: { Authorization: b2.token } });
  if (!r.ok) throw new Error(`B2 download ${r.status} for ${remoteName}`);
  await pipeline(r.body, createWriteStream(localFile));
  return localFile;
}

export async function b2Delete(b2, fileName, fileId) {
  await b2Json(`${b2.apiUrl}/b2api/v2/b2_delete_file_version`, { method: "POST", headers: { Authorization: b2.token }, body: JSON.stringify({ fileName, fileId }) });
}
