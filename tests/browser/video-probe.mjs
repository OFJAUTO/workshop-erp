// READ-ONLY probe (9 November 2026, Section 7): the resolution, frame rate and bitrate of recent gate-in videos.
// Downloads a few files from storage (nothing is written anywhere) and reads the MP4/MOV header boxes.
//   node --env-file=.env.local tests/browser/video-probe.mjs [count]
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const count = Number(process.argv[2] ?? 4);

function boxes(buf, start, end, out = []) {
  let i = start;
  while (i + 8 <= end) {
    let size = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    let header = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(i + 8)); header = 16; }
    if (size === 0) size = end - i;
    if (size < header || i + size > end) break;
    out.push({ type, start: i, header, size });
    if (["moov", "trak", "mdia", "minf", "stbl"].includes(type)) boxes(buf, i + header, i + size, out);
    i += size;
  }
  return out;
}

function probe(buf) {
  const all = boxes(buf, 0, buf.length);
  const tkhds = all.filter((b) => b.type === "tkhd");
  let width = 0, height = 0;
  for (const t of tkhds) {
    const p = t.start + t.header;
    const version = buf[p];
    const off = p + (version === 1 ? 88 : 76);
    const w = buf.readUInt32BE(off) / 65536;
    const h = buf.readUInt32BE(off + 4) / 65536;
    if (w * h > width * height) { width = w; height = h; }
  }
  const mdhd = all.find((b) => b.type === "mdhd");
  let seconds = null;
  const mvhd = all.find((b) => b.type === "mvhd");
  if (mvhd) {
    const p = mvhd.start + mvhd.header;
    const v = buf[p];
    const scale = v === 1 ? buf.readUInt32BE(p + 20) : buf.readUInt32BE(p + 12);
    const dur = v === 1 ? Number(buf.readBigUInt64BE(p + 24)) : buf.readUInt32BE(p + 16);
    seconds = scale ? dur / scale : null;
  }
  const stsz = all.find((b) => b.type === "stsz");
  void mdhd;
  return { width: Math.round(width), height: Math.round(height), seconds, frames: stsz ? buf.readUInt32BE(stsz.start + stsz.header + 8) : null };
}

const { data: rows, error: e } = await admin.from("gate_in_media").select("storage_path, kind, created_at").or("storage_path.ilike.%.mov,storage_path.ilike.%.mp4,storage_path.ilike.%.webm").order("created_at", { ascending: false }).limit(count);
if (e) console.log("read error:", e.message);
const data = (rows ?? []).map((r) => ({ name: r.storage_path, bucket_id: "gate-in-media", created_at: r.created_at, metadata: { mimetype: String(r.storage_path).split(".").pop() } }));
for (const o of data) {
  const { data: file, error } = await admin.storage.from(o.bucket_id).download(o.name);
  if (error || !file) { console.log("could not read", o.name); continue; }
  const buf = Buffer.from(await file.arrayBuffer());
  const p = probe(buf);
  const mbps = p.seconds ? (buf.length * 8) / p.seconds / 1e6 : null;
  console.log(JSON.stringify({ day: String(o.created_at).slice(0, 10), type: o.metadata?.mimetype, mb: +(buf.length / 1048576).toFixed(1), width: p.width, height: p.height, seconds: p.seconds ? +p.seconds.toFixed(1) : null, fps: p.seconds && p.frames ? +(p.frames / p.seconds).toFixed(1) : null, mbps: mbps ? +mbps.toFixed(2) : null }));
}
