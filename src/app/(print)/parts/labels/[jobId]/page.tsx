import { notFound } from "next/navigation";
import { PartSticker, stickerPageCss } from "@/components/StickerArt";
import { stickerPosition } from "@/lib/parts-list";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { JOB_BRIEF_SELECT, PART_FULL_SELECT, toPartFull, type JobBrief } from "@/lib/parts-data";
import { qrDataUrl } from "@/lib/pdf/qr";
import { getSettings } from "@/lib/settings";
import { ensureQrLink, qrUrl, stickerLogoDataUrl, stickerSettings } from "@/lib/stickers";
import { createAdminClient } from "@/lib/supabase/admin";
import { StickerSheet } from "./StickerSheet";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { data } = await createAdminClient().from("jobs").select("job_number").eq("id", jobId).maybeSingle();
  return { title: `Part stickers ${data?.job_number ?? ""}`.trim() };
}

/**
 * The part stickers of a job's received parts, one sticker per unit ("1 OF 2"), at the sticker size from Settings
 * (40 × 30 mm by default): the QR on the left, the logo and job number on the right, the part name in capitals on
 * the black strip. Opened the moment a part is ticked received (`?part=<id>&auto=1` prints at once). `?test=1`
 * prints one sample. Lives outside the app shell so the print is only the stickers.
 */
export default async function PartLabelsPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ test?: string; part?: string; parts?: string; auto?: string; back?: string }> }) {
  const staff = await requirePermission("viewPurchaseOrders");
  const { jobId } = await params;
  const { test, part, parts: partsCsv, auto, back } = await searchParams;
  const wanted = new Set((partsCsv ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  const settings = await getSettings();
  const ss = stickerSettings(settings);
  const admin = createAdminClient();
  const logo = await stickerLogoDataUrl(ss);
  const { data: job } = await admin.from("jobs").select(JOB_BRIEF_SELECT).eq("id", jobId).maybeSingle();
  if (!job && test !== "1") notFound();
  const j = (job as unknown as JobBrief | null) ?? null;
  const jobNumber = j?.job_number ?? "J-00000";
  type Label = { key: string; qr: string; name: string; index: number; count: number; date: string | null; pos?: string | null };
  const labels: Label[] = [];
  if (test === "1") {
    const qr = await qrDataUrl(qrUrl("TESTCODE"), 300);
    labels.push({ key: "test-1", qr, name: "Front brake pads set (sample)", index: 1, count: 2, date: formatDate(new Date().toISOString()) });
  } else {
    const { data } = await admin.from("part_items").select(PART_FULL_SELECT + ", fitted_at").eq("job_id", jobId).eq("is_active", true).gt("received_qty", 0).order("created_at");
    const parts = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...toPartFull(r), fitted_at: (r.fitted_at as string | null) ?? null })).filter((p) => (!part && !wanted.size) || p.id === part || wanted.has(p.id)).filter((p) => p.issue_status !== "confirmed" || !!part || wanted.has(p.id));
    for (const p of parts) {
      const code = await ensureQrLink("part", { jobId, refId: p.id }, staff.id);
      const qr = await qrDataUrl(qrUrl(code), 300);
      const count = Math.max(1, Math.round(Number(p.received_qty) || Number(p.confirmed_quantity ?? p.quantity) || 1));
      for (let n = 1; n <= count; n++) labels.push({ key: `${p.id}-${n}`, qr, name: p.description, index: n, count, date: null, pos: stickerPosition(p.positions, n, count) });
    }
  }
  const backHref = back || (test === "1" ? "/settings/stickers" : `/parts/${jobId}`);
  return (
    <div>
      <style>{stickerPageCss(ss.partW, ss.partH)}</style>
      {labels.length === 0 ? (
        <div className="bar"><span>No received parts to print yet. Stickers appear once a delivery is recorded.</span><a href={backHref} style={{ marginLeft: "auto" }}>Back</a></div>
      ) : (
        <StickerSheet
          items={labels.map((l) => ({ key: l.key, name: l.name, qty: l.count > 1 ? `${l.index} of ${l.count}` : "× 1" }))}
          printer={ss.printerPart}
          info={`${labels.length} sticker${labels.length === 1 ? "" : "s"} · ${ss.partW} × ${ss.partH} mm · ${test === "1" ? "test print" : jobNumber}`}
          auto={auto === "1"}
          extra={<a href={backHref} style={{ marginLeft: "auto" }}>Back</a>}
        >
          {labels.map((l) => (
            <PartSticker key={l.key} w={ss.partW} h={ss.partH} logoUrl={logo} d={{ qr: l.qr, jobNumber, name: l.name, index: l.index, count: l.count, date: l.date, pos: l.pos ?? null }} />
          ))}
        </StickerSheet>
      )}
    </div>
  );
}
