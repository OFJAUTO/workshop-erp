import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { BatterySticker, stickerPageCss } from "@/components/StickerArt";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { qrDataUrl } from "@/lib/pdf/qr";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { cleanBatch, warrantyTypesOf, warrantyUntil } from "@/lib/sticker-types";
import { ensureQrLink, qrUrl, stickerLogoDataUrl, stickerSettings } from "@/lib/stickers";
import { createAdminClient } from "@/lib/supabase/admin";
import { PrintNow } from "../../../parts/labels/[jobId]/PrintNow";

export const dynamic = "force-dynamic";

/**
 * A WARRANTY STICKER of a type the owner added on the Stickers tab (11 November 2026, Section 12): the battery sticker's
 * layout with the type's name, the start day, "Warranty until" and the VIN; a batch number only for a type that asks
 * one (PPF and tint). Opening it records the print on the job (the history); `?event=` prints that one again.
 */
export default async function WarrantyStickerPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ type?: string; batch?: string; ref?: string; back?: string }> }) {
  const staff = await requireStaff();
  if (!can(staff.role_id as RoleId, "printStickers")) notFound();
  const { jobId } = await params;
  const sp = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const ss = stickerSettings(settings);
  const types = warrantyTypesOf(settings.sticker_warranty_types);
  const { data: job } = await admin.from("jobs").select("id, job_number, vehicle:vehicles(vin)").eq("id", jobId).maybeSingle();
  if (!job) notFound();
  const vin = ((job as unknown as { vehicle: { vin: string | null } | null }).vehicle?.vin ?? "") as string;
  // A reprint reads what was printed the first time.
  let typeKey = sp.type ?? "";
  let batch = cleanBatch(sp.batch);
  // eslint-disable-next-line react-hooks/purity -- a server page: today is read once per request
  let start = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  // The sticker's own reference (a fresh uuid, kept in the print's history line and behind its QR).
  const reprint = !!sp.ref && /^[0-9a-f-]{36}$/i.test(sp.ref);
  const ref = reprint ? (sp.ref as string) : randomUUID();
  if (reprint) {
    const { data: evs } = await admin.from("job_events").select("from_stage").eq("job_id", jobId).eq("event_type", "warranty_sticker").like("from_stage", `%ref=${ref}%`).limit(1);
    const ev = (evs ?? [])[0] as { from_stage: string | null } | undefined;
    if (!ev) notFound();
    const meta = new URLSearchParams(ev.from_stage ?? "");
    typeKey = meta.get("type") ?? typeKey;
    batch = cleanBatch(meta.get("batch"));
    start = meta.get("start") ?? start;
  }
  const type = types.find((t) => t.key === typeKey && !t.builtIn);
  if (!type) notFound();
  if (!type.batch) batch = "";
  const until = warrantyUntil(start, type.months);
  const words = `${type.label}${batch ? ` · Batch ${batch}` : ""} · until ${formatDate(until)}`;
  if (!reprint) {
    await admin.from("job_events").insert({ job_id: jobId, event_type: "warranty_sticker", note: `Warranty sticker printed: ${words}`, from_stage: new URLSearchParams({ type: type.key, batch, start, ref }).toString(), created_by: staff.id });
  } else {
    await admin.from("job_events").insert({ job_id: jobId, event_type: "sticker_reprint", note: `Warranty sticker printed again by ${staff.display_name}: ${words}`, created_by: staff.id });
  }
  const code = await ensureQrLink("item", { jobId, refId: ref }, staff.id);
  const qr = await qrDataUrl(qrUrl(code), 300);
  const logo = await stickerLogoDataUrl(ss);
  return (
    <div>
      <style>{stickerPageCss(ss.batteryW, ss.batteryH)}</style>
      <div className="bar">
        <span>{type.label} warranty sticker · {(job as { job_number: string }).job_number}{reprint ? " · printed again" : ""}</span>
        <PrintNow label={`Print on ${ss.printerLarge}`} />
        <a href={sp.back || "/stickers?tab=warranty"} style={{ marginLeft: "auto" }}>Back</a>
      </div>
      <div data-warranty-sticker={type.key}>
        <BatterySticker w={ss.batteryW} h={ss.batteryH} logoUrl={logo} d={{ qr, months: type.months, installed: formatDate(start), until: formatDate(until), vin, title: `${type.label} warranty`, valid: ss.wording.battery_valid, line: batch ? `BATCH ${batch}` : "" }} />
      </div>
    </div>
  );
}
