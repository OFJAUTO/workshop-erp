/**
 * The three stickers as plain HTML, black on white, sized in millimetres, for the print pages and the live preview in
 * Settings. No styles from the app: these print bare.
 *
 * Part sticker (40 × 30 mm by default): the QR on the left (about 20 mm), the logo and the job number on the right,
 * and a bold black strip along the bottom with the part name in capitals and "1 OF 2".
 * Battery warranty sticker and oil service sticker (50 × 100 mm portrait by default): logo, title, the facts, a black
 * band with the date that matters, the VIN, a QR. The oil sticker's QR opens WhatsApp to book the next service.
 */
import { FitText } from "./FitText";
export type PartStickerData = { qr: string; jobNumber: string; name: string; index: number; count: number; date?: string | null; /** Where this unit goes (FRONT LEFT, or ALL 4 + SPARE). */ pos?: string | null };
export type BatteryStickerData = { qr: string; installed: string; until: string; months: number; vin: string; title: string; valid: string; /** Which battery: "Main battery · Varta AGM 95Ah" or "Auxiliary battery". */ line: string };

/** The line that says which battery the sticker is for, from the part's description, brand and model. */
export function batteryLine(description: string | null | undefined, brand?: string | null, model?: string | null) {
  const which = /aux/i.test(description ?? "") ? "Auxiliary battery" : "Main battery";
  return [which, [brand, model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
}
export type ServiceStickerData = { qr: string; servicedOn: string; mileage: string; nextDate: string; nextMileage: string; vin: string; plate: string; title: string; band: string; scanLine: string; phone: string | null };

const base = (w: number, h: number): React.CSSProperties => ({ width: `${w}mm`, height: `${h}mm`, boxSizing: "border-box", overflow: "hidden", background: "#fff", color: "#000", fontFamily: "Arial, Helvetica, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: "1mm", pageBreakAfter: "always", breakAfter: "page" });

export function PartSticker({ w, h, logoUrl, d }: { w: number; h: number; logoUrl: string; d: PartStickerData }) {
  const u = h / 30;
  const qr = Math.min(h * 0.68, w * 0.48);
  return (
    <div style={{ ...base(w, h), padding: `${1.5 * u}mm`, gap: `${1 * u}mm` }} data-part-sticker>
      <div style={{ display: "flex", width: "100%", flex: 1, minHeight: 0, gap: `${2 * u}mm`, alignItems: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.qr} alt="" style={{ width: `${qr}mm`, height: `${qr}mm`, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "space-between" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt="" style={{ height: `${6 * u}mm`, maxWidth: "100%", objectFit: "contain" }} />
          <div style={{ textAlign: "right", width: "100%", minWidth: 0 }}>
            <FitText text={d.jobNumber} maxMm={4.2 * u} minOneLineMm={2.2 * u} minMm={2.2 * u} allowWrap={false} lineHeight={1} style={{ fontWeight: 800, letterSpacing: "0.3px", textAlign: "right" }} />
            {d.date ? <div style={{ fontSize: `${2.2 * u}mm`, marginTop: `${0.6 * u}mm` }}>{d.date}</div> : null}
            {d.pos ? <div style={{ fontSize: `${2.2 * u}mm`, fontWeight: 800, marginTop: `${0.4 * u}mm`, textTransform: "uppercase", lineHeight: 1.1 }} data-sticker-pos>{d.pos}</div> : null}
          </div>
        </div>
      </div>
      <div style={{ width: "100%", flex: "none", background: "#000", color: "#fff", padding: `${1 * u}mm ${1.5 * u}mm`, fontSize: `${2.7 * u}mm`, fontWeight: 800, textTransform: "uppercase", display: "flex", justifyContent: "space-between", gap: `${2 * u}mm`, lineHeight: 1.15, letterSpacing: "0.2px" }}>
        <span style={{ flex: 1, minWidth: 0, alignSelf: "center" }}><FitText text={d.name} maxMm={2.7 * u} minOneLineMm={2.2 * u} minMm={1.9 * u} lineHeight={1.12} style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.2px" }} /></span>
        <span style={{ whiteSpace: "nowrap", flex: "none", alignSelf: "center", fontSize: `${1.9 * u}mm` }}>{d.index} OF {d.count}</span>
      </div>
    </div>
  );
}

/** Portrait: logo, title, which battery, installed, the black "Warranty until" band with the months, the QR, the VIN large, "Valid for this vehicle only". */
export function BatterySticker({ w, h, logoUrl, d }: { w: number; h: number; logoUrl: string; d: BatteryStickerData }) {
  const u = w / 50;
  return (
    <div style={{ ...base(w, h), padding: `${3 * u}mm`, justifyContent: "space-between", gap: `${1.5 * u}mm` }} data-battery-sticker>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt="" style={{ height: `${8 * u}mm`, maxWidth: `${42 * u}mm`, objectFit: "contain" }} />
      <div style={{ fontSize: `${4.2 * u}mm`, fontWeight: 800, letterSpacing: "0.5px", textTransform: "uppercase", textAlign: "center", lineHeight: 1.1 }}>{d.title}</div>
      <div style={{ fontSize: `${3 * u}mm`, fontWeight: 700, textAlign: "center", lineHeight: 1.25 }}>{d.line}</div>
      <div style={{ fontSize: `${3 * u}mm`, textAlign: "center", lineHeight: 1.3 }}>
        Installed <b>{d.installed}</b>
      </div>
      <div style={{ width: "100%", background: "#000", color: "#fff", padding: `${2 * u}mm ${2 * u}mm`, textAlign: "center" }}>
        <div style={{ fontSize: `${2.6 * u}mm`, letterSpacing: "0.5px", textTransform: "uppercase" }}>Warranty until</div>
        <div style={{ fontSize: `${5.4 * u}mm`, fontWeight: 800, marginTop: `${0.6 * u}mm`, lineHeight: 1.05 }}>{d.until}</div>
        <div style={{ fontSize: `${2.6 * u}mm`, marginTop: `${0.6 * u}mm` }}>{d.months} months</div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={d.qr} alt="" style={{ width: `${22 * u}mm`, height: `${22 * u}mm` }} />
      <div style={{ fontSize: `${3.4 * u}mm`, fontWeight: 800, letterSpacing: "0.6px", wordBreak: "break-all", textAlign: "center", lineHeight: 1.15 }}>{d.vin}</div>
      <div style={{ fontSize: `${2.6 * u}mm`, textAlign: "center" }}>{d.valid}</div>
    </div>
  );
}

/** Portrait: logo, title, serviced on and at, the black "Next service" band, the plate and VIN, the WhatsApp QR with "Scan to book", the phone. */
export function ServiceSticker({ w, h, logoUrl, d }: { w: number; h: number; logoUrl: string; d: ServiceStickerData }) {
  const u = w / 50;
  return (
    <div style={{ ...base(w, h), padding: `${3 * u}mm`, justifyContent: "space-between", gap: `${1.5 * u}mm` }} data-service-sticker>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt="" style={{ height: `${8 * u}mm`, maxWidth: `${42 * u}mm`, objectFit: "contain" }} />
      <div style={{ fontSize: `${4.6 * u}mm`, fontWeight: 800, letterSpacing: "0.5px", textTransform: "uppercase", textAlign: "center", lineHeight: 1.1 }}>{d.title}</div>
      <div style={{ fontSize: `${3 * u}mm`, textAlign: "center", lineHeight: 1.3 }}>
        Serviced on <b>{d.servicedOn}</b>
        {d.mileage ? <><br />at <b>{d.mileage}</b></> : null}
      </div>
      <div style={{ width: "100%", background: "#000", color: "#fff", padding: `${2 * u}mm ${2 * u}mm`, textAlign: "center" }}>
        <div style={{ fontSize: `${2.4 * u}mm`, letterSpacing: "0.4px", textTransform: "uppercase", lineHeight: 1.2 }}>{d.band}</div>
        <div style={{ fontSize: `${4.6 * u}mm`, fontWeight: 800, marginTop: `${0.8 * u}mm`, lineHeight: 1.05 }}>{d.nextDate}</div>
        {d.nextMileage ? <div style={{ fontSize: `${3.4 * u}mm`, fontWeight: 700, marginTop: `${0.5 * u}mm` }}>{d.nextMileage}</div> : null}
      </div>
      <div style={{ textAlign: "center", lineHeight: 1.2 }}>
        <div style={{ fontSize: `${4 * u}mm`, fontWeight: 800, letterSpacing: "0.5px" }}>{d.plate}</div>
        <div style={{ fontSize: `${2.6 * u}mm`, wordBreak: "break-all", marginTop: `${0.6 * u}mm` }}>{d.vin}</div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={d.qr} alt="" style={{ width: `${22 * u}mm`, height: `${22 * u}mm` }} />
      <div style={{ fontSize: `${2.6 * u}mm`, fontWeight: 700, textAlign: "center", lineHeight: 1.25 }}>{d.scanLine}</div>
      {d.phone ? <div style={{ fontSize: `${2.8 * u}mm`, textAlign: "center" }}>{d.phone}</div> : null}
    </div>
  );
}

/** The one style tag every sticker print page needs: the page is the sticker, no browser margins. */
export function stickerPageCss(w: number, h: number) {
  return `@page { size: ${w}mm ${h}mm; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; }
.bar { font-family: Arial, Helvetica, sans-serif; background: #111; color: #fff; padding: 10px 14px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 14px; }
.bar a { color: #fff; }
.bar button { font: 700 13px Arial, Helvetica, sans-serif; min-height: 40px; padding: 6px 14px; border: 0; border-radius: 8px; background: #fff; color: #111; cursor: pointer; }
.bar button:disabled { opacity: .5; cursor: default; }
.bar .print-btn { background: #0f7b4f; color: #fff; }
.sheet { font-family: Arial, Helvetica, sans-serif; display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 12px; padding: 12px; background: #f3f4f6; min-height: 100vh; align-content: start; }
.one { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid #d1d5db; border-radius: 10px; padding: 10px; }
.one.off { opacity: .4; }
.one .art { flex-shrink: 0; }
.pick { margin-left: auto; display: flex; align-items: center; gap: 10px; min-height: 48px; min-width: 48px; border: 0; background: none; text-align: right; cursor: pointer; font: 600 12px Arial, Helvetica, sans-serif; color: #111; }
.pick .meta { max-width: 150px; overflow: hidden; }
.tick { width: 36px; height: 36px; flex-shrink: 0; border-radius: 8px; border: 2px solid #9ca3af; background: #fff; color: transparent; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 20px; }
.tick-on { background: #0f7b4f; border-color: #0f7b4f; color: #fff; }
@media print {
  .bar, .pick { display: none !important; }
  .sheet { display: block; padding: 0; background: none; min-height: 0; }
  .one { display: block; border: 0; border-radius: 0; padding: 0; break-after: page; }
  .one.off { display: none; }
}`;
}
