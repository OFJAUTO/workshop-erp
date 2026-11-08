// THE BACKFILL OF PRE-MADE PHOTO SIZES (8 November 2026). Adds the 400 px thumbnail and the 1600 px medium copy to
// every EXISTING photo that has none yet, in the buckets of src/lib/photo-size-rules.ts. It ONLY ADDS files under
// `_sizes/`; it never changes or deletes an original (they are evidence) and never calls Supabase's image
// transformations (the sizes are drawn here with sharp).
//
//   Count only, read-only (default):   node --env-file=.env.local scripts/photo-sizes-backfill.mjs
//   Make the sizes (after "apply"):    node --env-file=.env.local scripts/photo-sizes-backfill.mjs --apply
//   The test project:                  node --env-file=.env.test.local scripts/photo-sizes-backfill.mjs [--apply]
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { pathToFileURL } from "node:url";
import path from "node:path";

const rules = await import(pathToFileURL(path.resolve("src/lib/photo-size-rules.ts")).href);
const { PHOTO_SIZES, SIZED_BUCKETS, SIZES_FOLDER, SIZED_CACHE_SECONDS, isSizablePhoto, sizedPath } = rules;

const APPLY = process.argv.includes("--apply");
const SAMPLE = 12;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase address or server key missing from the env file.");
const admin = createClient(url, key, { auth: { persistSession: false } });
console.log(`${APPLY ? "MAKING SIZES" : "COUNT ONLY (read-only)"} on ${url.replace(/^https:\/\//, "").split(".")[0]}`);

/** Every object under a prefix, folders followed (the storage list API returns one level at a time). */
async function walk(bucket, prefix, out) {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const o of data ?? []) {
      const full = prefix ? `${prefix}/${o.name}` : o.name;
      if (o.id === null) {
        if (full === SIZES_FOLDER) continue;
        await walk(bucket, full, out);
      } else out.push({ path: full, size: o.metadata?.size ?? 0, type: o.metadata?.mimetype ?? null });
    }
    if ((data ?? []).length < 1000) break;
  }
}

async function sizesOf(buf) {
  const res = {};
  for (const [name, width] of Object.entries(PHOTO_SIZES)) {
    res[name] = await sharp(buf, { failOn: "none" }).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: name === "thumb" ? 70 : 80, mozjpeg: true }).toBuffer();
  }
  return res;
}

let grand = { photos: 0, todo: 0, originalBytes: 0, made: 0, failed: 0, addedBytes: 0 };
const samples = [];
for (const bucket of SIZED_BUCKETS) {
  const all = [];
  try {
    await walk(bucket, "", all);
  } catch (e) {
    console.log(`  ${bucket}: not readable (${e.message}) - skipped`);
    continue;
  }
  const existing = [];
  await walk(bucket, SIZES_FOLDER, existing).catch(() => {});
  const have = new Set(existing.map((o) => o.path));
  const photos = all.filter((o) => isSizablePhoto(o.path, o.type));
  const todo = photos.filter((o) => !have.has(sizedPath(o.path, "thumb")) || !have.has(sizedPath(o.path, "medium")));
  const bytes = todo.reduce((s, o) => s + o.size, 0);
  grand.photos += photos.length;
  grand.todo += todo.length;
  grand.originalBytes += bytes;
  console.log(`  ${bucket}: ${photos.length} photos, ${todo.length} without sizes (${(bytes / 1048576).toFixed(1)} MB of originals)`);
  if (!APPLY) {
    for (const o of todo.slice(0, Math.ceil(SAMPLE / SIZED_BUCKETS.length))) {
      const { data } = await admin.storage.from(bucket).download(o.path);
      if (!data) continue;
      try {
        const s = await sizesOf(Buffer.from(await data.arrayBuffer()));
        samples.push({ original: o.size, added: s.thumb.length + s.medium.length });
      } catch { /* an unreadable picture is skipped in the estimate */ }
    }
    continue;
  }
  for (const o of todo) {
    try {
      const { data } = await admin.storage.from(bucket).download(o.path);
      if (!data) throw new Error("not readable");
      const s = await sizesOf(Buffer.from(await data.arrayBuffer()));
      for (const [name, buf] of Object.entries(s)) {
        const { error } = await admin.storage.from(bucket).upload(sizedPath(o.path, name), buf, { contentType: "image/jpeg", upsert: true, cacheControl: String(SIZED_CACHE_SECONDS) });
        if (error) throw new Error(error.message);
        grand.addedBytes += buf.length;
      }
      grand.made += 1;
      if (grand.made % 50 === 0) console.log(`    … ${grand.made} done`);
    } catch (e) {
      grand.failed += 1;
      console.log(`    FAILED ${bucket}/${o.path}: ${e.message}`);
    }
  }
}

console.log(`TOTAL: ${grand.photos} photos, ${grand.todo} without sizes, ${(grand.originalBytes / 1073741824).toFixed(2)} GB of originals.`);
if (!APPLY) {
  const ratio = samples.length ? samples.reduce((s, x) => s + x.added, 0) / Math.max(1, samples.reduce((s, x) => s + x.original, 0)) : 0;
  const perPhoto = samples.length ? samples.reduce((s, x) => s + x.added, 0) / samples.length : 0;
  console.log(`ESTIMATE from ${samples.length} sample photos: about ${(perPhoto / 1024).toFixed(0)} KB added per photo (${(ratio * 100).toFixed(0)}% of the original), so about ${((perPhoto * grand.todo) / 1073741824).toFixed(2)} GB extra storage for ${grand.todo} files x 2 sizes.`);
} else {
  console.log(`MADE sizes for ${grand.made} photos (${(grand.addedBytes / 1073741824).toFixed(2)} GB added), ${grand.failed} failed. Nothing was deleted or changed.`);
}
