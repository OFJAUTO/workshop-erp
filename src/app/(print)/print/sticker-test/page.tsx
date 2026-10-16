import { notFound } from "next/navigation";
import { BatterySticker, PartSticker, ServiceSticker, stickerPageCss } from "@/components/StickerArt";
import { requirePermission } from "@/lib/auth";
import { qrDataUrl } from "@/lib/pdf/qr";
import { getSettings } from "@/lib/settings";
import { qrUrl, serviceWhatsAppUrl, stickerSettings, stickerLogoDataUrl } from "@/lib/stickers";
import { PrintNow } from "../../parts/labels/[jobId]/PrintNow";

export const dynamic = "force-dynamic";

/** A test print of one sticker type with sample words, from the Stickers tab in Settings. */
export default async function StickerTestPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requirePermission("manageSettings");
  const { kind } = await searchParams;
  const settings = await getSettings();
  const ss = stickerSettings(settings);
  const logo = await stickerLogoDataUrl(ss);
  const qr = await qrDataUrl(qrUrl("TESTCODE"), 300);
  const waQr = await qrDataUrl(serviceWhatsAppUrl(ss, "DUBAI A 12345"), 300);
  if (kind !== "part" && kind !== "battery" && kind !== "service") notFound();
  const w = kind === "part" ? ss.partW : kind === "battery" ? ss.batteryW : ss.serviceW;
  const h = kind === "part" ? ss.partH : kind === "battery" ? ss.batteryH : ss.serviceH;
  const printer = kind === "part" ? ss.printerPart : ss.printerLarge;
  return (
    <div>
      <style>{stickerPageCss(w, h)}</style>
      <div className="bar"><span>Test sticker · {kind} · {w} × {h} mm</span><PrintNow label={`Print on ${printer}`} /><a href="/settings/stickers" style={{ marginLeft: "auto" }}>Back to Settings</a></div>
      {kind === "part" ? <PartSticker w={ss.partW} h={ss.partH} logoUrl={logo} d={{ qr, jobNumber: "J-00123", name: "Front brake pads set", index: 1, count: 2, date: "16 Oct 2026" }} /> : null}
      {kind === "battery" ? <BatterySticker w={ss.batteryW} h={ss.batteryH} logoUrl={logo} d={{ qr, line: "Main battery · Varta AGM 95Ah", installed: "16 Oct 2026", until: "16 Oct 2028", months: 24, vin: "WDCYC7CFXHX266190", title: ss.wording.battery, valid: ss.wording.battery_valid }} /> : null}
      {kind === "service" ? <ServiceSticker w={ss.serviceW} h={ss.serviceH} logoUrl={logo} d={{ qr: waQr, servicedOn: "16 Oct 2026", mileage: "42,000 km", nextDate: "16 Oct 2027", nextMileage: "52,000 km", vin: "WDCYC7CFXHX266190", plate: "DUBAI A 12345", title: ss.wording.service, band: ss.wording.service_band, scanLine: ss.wording.service_scan, phone: ss.servicePhone ? ss.phone : null }} /> : null}
    </div>
  );
}
