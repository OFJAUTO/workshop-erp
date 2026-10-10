import { notFound } from "next/navigation";
import { stickerPageCss } from "@/components/StickerArt";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { loadJobItems } from "@/lib/loose-items";
import { qrDataUrl } from "@/lib/pdf/qr";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { qrUrl, stickerLogoDataUrl, stickerSettings } from "@/lib/stickers";
import { createAdminClient } from "@/lib/supabase/admin";
import { PrintNow } from "../../../parts/labels/[jobId]/PrintNow";

export const dynamic = "force-dynamic";

/**
 * One tag per loose item at the large sticker size: logo, job number, customer, what it is, how many,
 * and a QR code that opens the job card for staff (a plain page for anyone else).
 */
export default async function ItemTagsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "gateIn") || can(role, "viewJobs") || can(role, "priceParts"))) notFound();
  const { jobId } = await params;
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, gated_in_at, job_kind, customer:customers(full_name, company_name)").eq("id", jobId).maybeSingle();
  if (!job) notFound();
  const customer = job.customer as unknown as { full_name: string; company_name: string | null } | null;
  const items = await loadJobItems(jobId);
  const settings = await getSettings();
  const ss = stickerSettings(settings);
  const logo = await stickerLogoDataUrl(ss);
  const size = ss.large;
  const date = formatDate(job.gated_in_at);
  const tags: React.ReactNode[] = [];
  for (const it of items) {
    const qr = it.qr_code ? await qrDataUrl(qrUrl(it.qr_code), 300) : null;
    tags.push(
      <div key={it.id} style={{ width: `${size}mm`, height: `${size}mm`, boxSizing: "border-box", padding: `${size * 0.05}mm`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", fontFamily: "system-ui, sans-serif", color: "#111113", textAlign: "center", pageBreakAfter: "always" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" style={{ height: `${size * 0.14}mm`, maxWidth: `${size * 0.8}mm`, objectFit: "contain" }} />
        <div style={{ fontSize: `${size * 0.11}mm`, fontWeight: 800, lineHeight: 1.1 }}>{job.job_number}</div>
        <div style={{ fontSize: `${size * 0.065}mm`, fontWeight: 600, lineHeight: 1.15, maxHeight: `${size * 0.16}mm`, overflow: "hidden" }}>{customer?.company_name ?? customer?.full_name ?? ""}</div>
        <div style={{ fontSize: `${size * 0.075}mm`, fontWeight: 700, lineHeight: 1.15 }}>{it.quantity > 1 ? `${it.quantity} × ` : ""}{it.item_type}{it.description ? ` · ${it.description}` : ""}</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr ? <img src={qr} alt="" style={{ width: `${size * 0.38}mm`, height: `${size * 0.38}mm` }} /> : null}
        <div style={{ fontSize: `${size * 0.055}mm`, color: "#5F6368" }}>Item {it.position} of {items.length} · {date}</div>
      </div>,
    );
  }
  return (
    <div>
      <style>{stickerPageCss(size, size)}</style>
      <PrintNow />
      {tags.length ? tags : <p style={{ padding: 16, fontFamily: "system-ui" }}>No items on this job.</p>}
    </div>
  );
}
