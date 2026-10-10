import { BatterySticker, PartSticker, ServiceSticker } from "@/components/StickerArt";
import { Button, Card, Field, Input, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { qrDataUrl } from "@/lib/pdf/qr";
import { getSettings } from "@/lib/settings";
import { qrUrl, stickerLogoDataUrl, stickerSettings } from "@/lib/stickers";
import { saveStickerSettings, uploadStickerLogo } from "./actions";

export const dynamic = "force-dynamic";

/** Owner only: everything about the three stickers, with a live preview and a test print. */
export default async function StickersSettingsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("manageSettings");
  const { message, error } = await searchParams;
  const settings = await getSettings();
  const ss = stickerSettings(settings);
  const logo = await stickerLogoDataUrl(ss);
  const qr = await qrDataUrl(qrUrl("TESTCODE"), 240);
  const brandLines = Object.entries(ss.warrantyByBrand).map(([b, m]) => `${b} = ${m}`).join("\n");
  const scale = 3; // the preview shows the stickers at three times life size
  return (
    <>
      <PageHeader title="Stickers" subtitle="Part sticker, battery warranty sticker and oil service sticker: size, wording, defaults, intervals, logo. Changes apply to stickers printed from now on." actions={<LinkButton href="/settings" tone="secondary">Back to Settings</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <form action={saveStickerSettings} className="xl:col-span-2 flex flex-col gap-4">
          <Card className="flex flex-col gap-4">
            <SectionLabel>Part sticker</SectionLabel>
            <p className="text-xs text-muted">Logo on top, QR in the middle, date and the last 8 characters of the VIN underneath. Optional: the handover counter starts at 0, except for the part types below.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Width (mm)"><Input name="sticker_part_width_mm" defaultValue={String(ss.partW)} inputMode="decimal" required /></Field>
              <Field label="Height (mm)"><Input name="sticker_part_height_mm" defaultValue={String(ss.partH)} inputMode="decimal" required /></Field>
            </div>
            <Field label="Part types that get a sticker by default" hint="One per line or separated by commas, as written in the part types list (for example Genuine). The counter starts at the quantity for these." optional>
              <Textarea name="sticker_part_types" defaultValue={(settings.sticker_part_types as string[] | undefined)?.join("\n") ?? ""} rows={2} />
            </Field>
            <label className="flex items-start gap-3 cursor-pointer text-sm"><input type="checkbox" name="part_labels_enabled" defaultChecked={settings.part_labels_enabled === true} className="mt-1 h-5 w-5 accent-ink" /><span><span className="font-semibold">Tracking labels for boxes</span><span className="block text-xs text-muted">Off: nothing is made when parts arrive. A part that waits on a shelf still has its Print label button.</span></span></label>
          </Card>
          <Card className="flex flex-col gap-4">
            <SectionLabel>Battery warranty sticker</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Size (mm, square)" hint="Also the service sticker."><Input name="sticker_large_mm" defaultValue={String(ss.large)} inputMode="decimal" required /></Field>
              <Field label="Warranty (months)"><Input name="battery_warranty_months" defaultValue={String(ss.warrantyMonths)} inputMode="numeric" required /></Field>
              <Field label="Title"><Input name="w_battery" defaultValue={ss.wording.battery} /></Field>
              <Field label="Bottom line"><Input name="w_battery_valid" defaultValue={ss.wording.battery_valid} /></Field>
            </div>
            <Field label="Warranty per brand (months)" hint="One per line: Brand = months. For example Bosch = 24." optional><Textarea name="battery_warranty_by_brand" defaultValue={brandLines} rows={3} /></Field>
            <label className="flex items-start gap-3 cursor-pointer text-sm"><input type="checkbox" name="sticker_battery_required" defaultChecked={ss.batteryRequired} className="mt-1 h-5 w-5 accent-ink" /><span><span className="font-semibold">Required</span><span className="block text-xs text-muted">The handover of a battery cannot finish without printing one sticker per battery.</span></span></label>
          </Card>
          <Card className="flex flex-col gap-4">
            <SectionLabel>Oil service sticker</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Next service after (months)"><Input name="service_interval_months" defaultValue={String(ss.intervalMonths)} inputMode="numeric" required /></Field>
              <Field label="Next service after (km)"><Input name="service_interval_km" defaultValue={String(ss.intervalKm)} inputMode="numeric" required /></Field>
              <Field label="Next service after (miles)"><Input name="service_interval_miles" defaultValue={String(ss.intervalMiles)} inputMode="numeric" required /></Field>
              <Field label="Title"><Input name="w_service" defaultValue={ss.wording.service} /></Field>
              <div className="col-span-2 sm:col-span-4"><Field label="Black band"><Input name="w_service_band" defaultValue={ss.wording.service_band} /></Field></div>
            </div>
            <label className="flex items-start gap-3 cursor-pointer text-sm"><input type="checkbox" name="sticker_service_required" defaultChecked={ss.serviceRequired} className="mt-1 h-5 w-5 accent-ink" /><span><span className="font-semibold">Required on jobs with an oil change</span><span className="block text-xs text-muted">The job card says &quot;not printed yet&quot; until it is, and QC checks it is fitted.</span></span></label>
            <label className="flex items-start gap-3 cursor-pointer text-sm"><input type="checkbox" name="sticker_service_show_phone" defaultChecked={ss.servicePhone} className="mt-1 h-5 w-5 accent-ink" /><span><span className="font-semibold">Workshop phone on this sticker</span><span className="block text-xs text-muted">{ss.phone || "Set the phone under Company in Settings."}</span></span></label>
          </Card>
          <input type="hidden" name="w_part" value={ss.wording.part} />
          <div><Button type="submit" size="lg">Save sticker settings</Button></div>
        </form>
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Logo</SectionLabel>
            <p className="text-xs text-muted">Used as it is on every sticker. Empty: the standard logo file.</p>
            <form action={uploadStickerLogo} className="flex flex-col gap-2">
              <input type="file" name="logo" accept="image/svg+xml,image/png,image/jpeg" className="text-sm" />
              <div className="flex gap-2"><Button type="submit" size="md">Upload logo</Button><Button type="submit" name="reset" value="1" tone="ghost" size="md">Standard logo</Button></div>
            </form>
          </Card>
          <Card className="flex flex-col gap-3">
            <SectionLabel>Preview (3 times life size)</SectionLabel>
            <div className="flex flex-col gap-4 overflow-x-auto">
              <div style={{ zoom: scale }} className="border border-dashed border-line-strong self-start"><PartSticker w={ss.partW} h={ss.partH} logoUrl={logo} d={{ qr, date: "10 Oct 2026", vin8: "HX266190" }} /></div>
              <div style={{ zoom: scale }} className="border border-dashed border-line-strong self-start"><BatterySticker size={ss.large} logoUrl={logo} d={{ qr, installed: "10 Oct 2026", until: "10 Oct 2027", vin: "WDCYC7CFXHX266190", title: ss.wording.battery, valid: ss.wording.battery_valid }} /></div>
              <div style={{ zoom: scale }} className="border border-dashed border-line-strong self-start"><ServiceSticker size={ss.large} logoUrl={logo} d={{ qr, servicedOn: "10 Oct 2026", mileage: "42,000 km", nextDate: "10 Oct 2027", nextMileage: "52,000 km", vin: "WDCYC7CFXHX266190", title: ss.wording.service, band: ss.wording.service_band, phone: ss.servicePhone ? ss.phone : null }} /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/print/sticker-test?kind=part" tone="secondary" size="md">Print test part sticker</LinkButton>
              <LinkButton href="/print/sticker-test?kind=battery" tone="secondary" size="md">Print test battery sticker</LinkButton>
              <LinkButton href="/print/sticker-test?kind=service" tone="secondary" size="md">Print test service sticker</LinkButton>
            </div>
            <p className="text-xs text-muted">Printing uses the normal browser print dialog on a page sized exactly to the sticker, with a PDF download as the fallback. Tell me the printer model and I will set its paper size.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
