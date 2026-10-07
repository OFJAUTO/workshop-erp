import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { GATE_IN_BUCKET } from "@/lib/media";
import { authoriseUpload } from "@/lib/upload-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const KINDS = ["video", "video_exterior", "video_interior", "dashboard_photo", "keys_photo", "keys_photo_front", "keys_photo_back", "damage_photo", "gate_out_photo", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"];
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/** Step 1 of an upload: hands the browser a one-time address to send the file to. */
export async function POST(request: NextRequest) {
  let body: { jobId?: string; kind?: string; contentType?: string; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "");
  const kind = String(body.kind ?? "");
  const contentType = String(body.contentType ?? "").split(";")[0].trim();
  if (!jobId || !KINDS.includes(kind) || !EXT[contentType]) {
    return NextResponse.json({ error: "That file type is not accepted." }, { status: 400 });
  }
  const who = await authoriseUpload(jobId, body.token);
  if (!who) return NextResponse.json({ error: "Not allowed, or the link has expired." }, { status: 403 });

  const path = `${jobId}/${kind}-${Date.now()}-${randomBytes(3).toString("hex")}.${EXT[contentType]}`;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(GATE_IN_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "Could not prepare the upload." }, { status: 500 });

  return NextResponse.json({ path: data.path, url: data.signedUrl });
}
