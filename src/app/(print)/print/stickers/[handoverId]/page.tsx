import { notFound } from "next/navigation";
import { BatterySticker, PartSticker, batteryLine, stickerPageCss } from "@/components/StickerArt";
import { stickerPosition } from "@/lib/parts-list";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { HANDOVER_SELECT, type HandoverRow } from "@/lib/handover";
import { qrDataUrl } from "@/lib/pdf/qr";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { qrUrl, stickerSettings, warrantyMonthsFor, stickerLogoDataUrl } from "@/lib/stickers";
import { createAdminClient } from "@/lib/supabase/admin";
import { StickerSheet } from "../../../parts/labels/[jobId]/StickerSheet";

export const dynamic = "force-dynamic";

/**
 * The stickers of one handover, one per page at the sticker's exact size: the part stickers (logo,
 * QR, date, last 8 of the VIN) and the battery warranty stickers. Opening this page counts as
 * printing it; a reprint is written down.
 */
export default async function HandoverStickersPage({ params, searchParams }: { params: Promise<{ handoverId: string }>; searchParams: Promise<{ back?: string; reprint?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "managePurchaseOrders") || role === "owner")) notFound();
  const { handoverId } = await params;
  const { back, reprint } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const ss = stickerSettings(settings);
  const logo = await stickerLogoDataUrl(ss);
  const { data: raw } = await admin.from("part_handovers").select(HANDOVER_SELECT + ", job:jobs(job_number, vehicle:vehicles(vin))").eq("id", handoverId).maybeSingle();
  if (!raw) notFound();
  const h = raw as unknown as HandoverRow & { job: { job_number: string; vehicle: { vin: string | null } | null } | null };
  const vin = h.job?.vehicle?.vin ?? "";
  const date = formatDate(h.confirmed_at ?? h.created_at);
  const plan = Object.entries(h.stickers ?? {});
  const { data: wmRows } = plan.length ? await admin.from("part_items").select("id, warranty_months, positions").in("id", plan.map(([id]) => id)) : { data: [] as { id: string; warranty_months: number | null; positions: string[] | null }[] };
  const partPositions = new Map((wmRows ?? []).map((r) => [r.id as string, ((r as { positions?: string[] | null }).positions ?? null)]));
  const partMonths = new Map((wmRows ?? []).map((r) => [r.id as string, (r.warranty_months as number | null) ?? null]));
  const first = !h.stickers_printed_at;
  if (first) await admin.from("part_handovers").update({ stickers_printed_at: new Date().toISOString(), updated_by: staff.id }).eq("id", handoverId);
  else if (reprint !== "0") await admin.from("job_events").insert({ job_id: h.job_id, event_type: "sticker_reprint", note: `Stickers of the handover printed again by ${staff.display_name}`, created_by: staff.id });
  const stickers: React.ReactNode[] = [];
  const sheetItems: { key: string; name: string; qty: string }[] = [];
  for (const [partId, s] of plan) {
    const item = h.items.find((i) => i.id === partId);
    const qr = await qrDataUrl(qrUrl(s.code), 300);
    for (let n = 0; n < s.count; n++) {
      sheetItems.push({ key: `${partId}-${n}`, name: item?.description ?? (s.kind === "battery" ? "Battery" : "Part"), qty: s.count > 1 ? `${n + 1} of ${s.count}` : "× 1" });
      if (s.kind === "battery") {
        const months = warrantyMonthsFor(ss, s.brand, partMonths.get(partId) ?? null);
        const until = new Date(h.confirmed_at ?? h.created_at);
        until.setUTCMonth(until.getUTCMonth() + months);
        stickers.push(<BatterySticker key={`${partId}-${n}`} w={ss.batteryW} h={ss.batteryH} logoUrl={logo} d={{ qr, months, installed: date, until: formatDate(until.toISOString()), vin, title: ss.wording.battery, valid: ss.wording.battery_valid, line: batteryLine(item?.description, s.brand, s.model) }} />);
      } else {
        stickers.push(<PartSticker key={`${partId}-${n}`} w={ss.partW} h={ss.partH} logoUrl={logo} d={{ qr, jobNumber: h.job?.job_number ?? "", name: item?.description ?? "Part", index: n + 1, count: s.count, date, pos: stickerPosition(partPositions.get(partId), n + 1, s.count) }} />);
      }
    }
  }
  const battery = plan.some(([, s]) => s.kind === "battery");
  const w = battery ? Math.max(ss.batteryW, ss.partW) : ss.partW;
  const hh = battery ? Math.max(ss.batteryH, ss.partH) : ss.partH;
  return (
    <div>
      <style>{stickerPageCss(w, hh)}</style>
      {stickers.length === 0 ? (
        <div className="bar"><span>No stickers were asked for on this handover.</span><a href={back || `/parts/handover/${h.job_id}`} style={{ marginLeft: "auto" }}>Back to the handover</a></div>
      ) : (
        <StickerSheet
          items={sheetItems}
          printer={battery ? ss.printerLarge : ss.printerPart}
          info={`${stickers.length} sticker${stickers.length === 1 ? "" : "s"} · ${h.job?.job_number ?? ""}${first ? "" : " · printed again"}`}
          extra={<><a href={`/api/pdf/stickers/${handoverId}`}>Download PDF</a><a href={back || `/parts/handover/${h.job_id}`} style={{ marginLeft: "auto" }}>Back to the handover</a></>}
        >
          {stickers}
        </StickerSheet>
      )}
    </div>
  );
}
