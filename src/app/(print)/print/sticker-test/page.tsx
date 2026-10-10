import { notFound } from "next/navigation";
import { BatterySticker, PartSticker, ServiceSticker, stickerPageCss } from "@/components/StickerArt";
import { requirePermission } from "@/lib/auth";
import { qrDataUrl } from "@/lib/pdf/qr";
import { getSettings } from "@/lib/settings";
import { qrUrl, stickerSettings, stickerLogoDataUrl } from "@/lib/stickers";
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
  if (kind !== "part" && kind !== "battery" && kind !== "service") notFound();
  const w = kind === "part" ? ss.partW : ss.large;
  const h = kind === "part" ? ss.partH : ss.large;
  return (
    <div>
      <style>{stickerPageCss(w, h)}</style>
      <div className="bar"><span>Test sticker · {kind}</span><PrintNow /><a href="/settings/stickers" style={{ marginLeft: "auto" }}>Back to Settings</a></div>
      {kind === "part" ? <PartSticker w={ss.partW} h={ss.partH} logoUrl={logo} d={{ qr, date: "10 Oct 2026", vin8: "HX266190" }} /> : null}
      {kind === "battery" ? <BatterySticker size={ss.large} logoUrl={logo} d={{ qr, installed: "10 Oct 2026", until: "10 Oct 2027", vin: "WDCYC7CFXHX266190", title: ss.wording.battery, valid: ss.wording.battery_valid }} /> : null}
      {kind === "service" ? <ServiceSticker size={ss.large} logoUrl={logo} d={{ qr, servicedOn: "10 Oct 2026", mileage: "42,000 km", nextDate: "10 Oct 2027", nextMileage: "52,000 km", vin: "WDCYC7CFXHX266190", title: ss.wording.service, band: ss.wording.service_band, phone: ss.servicePhone ? ss.phone : null }} /> : null}
    </div>
  );
}
