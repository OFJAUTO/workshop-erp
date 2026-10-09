import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { JOB_BRIEF_SELECT, PART_FULL_SELECT, toPartFull, type JobBrief } from "@/lib/parts-data";
import { qrDataUrl } from "@/lib/pdf/qr";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { PrintNow } from "./PrintNow";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { data } = await createAdminClient().from("jobs").select("job_number").eq("id", jobId).maybeSingle();
  return { title: `Part labels ${data?.job_number ?? ""}`.trim() };
}

/**
 * QR labels for the received parts of a job, one per part: plate, job number, part number and
 * description. Sized by the label settings; the page prints straight onto the thermal printer.
 * Lives outside the app shell (no sidebar) so the print is only the labels. `?test=1` prints one
 * sample label to check the size.
 */
export default async function PartLabelsPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ test?: string; part?: string }> }) {
  await requirePermission("viewPurchaseOrders");
  const { jobId } = await params;
  const { test, part } = await searchParams;
  const settings = await getSettings();
  const w = Number(settings.label_width_mm) || 50;
  const h = Number(settings.label_height_mm) || 30;
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select(JOB_BRIEF_SELECT).eq("id", jobId).maybeSingle();
  if (!job && test !== "1") notFound();
  const j = (job as unknown as JobBrief | null) ?? null;
  const plate = j?.vehicle ? formatPlate(j.vehicle) : "DUBAI A 12345";
  let labels: { code: string; part_number: string | null; description: string; qty: number }[] = [];
  if (test === "1") labels = [{ code: "PTESTLABEL", part_number: "95B698151", description: "Front brake pads set (sample)", qty: 1 }];
  else {
    const { data } = await admin.from("part_items").select(PART_FULL_SELECT).eq("job_id", jobId).eq("is_active", true).gt("received_qty", 0).order("created_at");
    labels = ((data ?? []) as unknown as Record<string, unknown>[]).map(toPartFull).filter((p) => p.label_code && (!part || p.id === part)).map((p) => ({ code: p.label_code!, part_number: p.part_number, description: p.description, qty: p.received_qty }));
  }
  const qrs = await Promise.all(labels.map((l) => qrDataUrl(l.code, 300)));
  const css = `@page { size: ${w}mm ${h}mm; margin: 0; } html, body { margin: 0; background: #fff; } .labels { font-family: Arial, Helvetica, sans-serif; color: #000; } .label { width: ${w}mm; height: ${h}mm; box-sizing: border-box; padding: 1.5mm; display: flex; gap: 1.5mm; align-items: center; page-break-after: always; break-after: page; overflow: hidden; } .label img { width: ${Math.min(h - 3, 26)}mm; height: ${Math.min(h - 3, 26)}mm; } .text { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; } .plate { font-size: ${h >= 40 ? 13 : 10}pt; font-weight: 800; letter-spacing: 0.04em; } .job { font-size: 8pt; font-weight: 700; } .pn { font-size: 8.5pt; font-weight: 700; margin-top: 0.8mm; } .desc { font-size: 7pt; line-height: 1.15; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; } .code { font-size: 6pt; color: #444; margin-top: 0.6mm; } @media screen { .labels { background: #888; padding: 10mm; min-height: 100vh; } .label { background: #fff; margin: 0 auto 6mm; box-shadow: 0 1px 6px rgba(0,0,0,.4); } .bar { position: fixed; top: 0; left: 0; right: 0; background: #111; color: #fff; padding: 8px 12px; font: 600 13px Arial, sans-serif; display: flex; gap: 12px; align-items: center; z-index: 2; } .spacer { height: 32px; } } @media print { .bar, .spacer { display: none; } .labels { padding: 0; background: #fff; } }`;
  return (
    <div className="labels">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="bar">
        <span>{labels.length} label{labels.length === 1 ? "" : "s"} · {w} × {h} mm · {test === "1" ? "test print" : j?.job_number}</span>
        <PrintNow />
        <a href={test === "1" ? "/settings" : `/parts/issue/${jobId}`} style={{ color: "#fff", marginLeft: "auto" }}>Back</a>
      </div>
      <div className="spacer" />
      {labels.length === 0 ? <p style={{ background: "#fff", padding: 12 }}>No received parts with labels yet. Labels appear once a delivery is recorded.</p> : null}
      {labels.map((l, i) => (
        <div key={l.code} className="label">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrs[i]} alt={l.code} />
          <div className="text">
            <div className="plate">{plate}</div>
            <div className="job">{j?.job_number ?? "J-00000"}{l.qty > 1 ? ` · × ${l.qty}` : ""}</div>
            <div className="pn">{l.part_number ?? "no part no."}</div>
            <div className="desc">{l.description}</div>
            <div className="code">{l.code}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
