import { NextResponse, type NextRequest } from "next/server";
import { loadGateInFlags, loadMedia, mediaChecklist, signMedia } from "@/lib/media";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const VIDEO_KINDS = ["video", "video_exterior", "video_interior"];

/**
 * The customer's check-in videos with fresh, short-lived addresses: called by the approval page when a video is
 * still on its way (every few seconds until it arrives) and when the customer taps Play on a page that has been
 * open for a while, so an address never goes stale. Only the approval token opens it.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t") ?? "";
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const admin = createAdminClient();
  const { data: req } = await admin.from("approval_requests").select("job_id").eq("token", token).maybeSingle();
  if (!req) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const [media, flags] = await Promise.all([loadMedia(req.job_id), loadGateInFlags(req.job_id)]);
  const videos = media.filter((m) => VIDEO_KINDS.includes(m.kind));
  const urls = await signMedia(videos, 3600);
  const check = mediaChecklist(media, flags);
  const legacy = videos.some((v) => v.kind === "video");
  return NextResponse.json(
    {
      videos: videos.map((v) => ({ id: v.id, kind: v.kind, url: urls.get(v.storage_path) ?? null, duration_s: v.duration_s, taken_at: v.taken_at })).filter((v) => v.url),
      expected: legacy ? ["video"] : ["video_exterior", "video_interior"],
      complete: check.videoExterior && check.videoInterior,
      signedAt: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
