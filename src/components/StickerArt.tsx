/**
 * The three stickers as plain HTML, black on white, sized in millimetres, for the print pages and the live preview in
 * Settings. No styles from the app: these print bare.
 *
 * Part sticker (40 × 30 mm by default): the QR on the left (about 20 mm), the logo and the job number on the right,
 * and a bold black strip along the bottom with the part name in capitals and "1 OF 2".
 * Battery warranty sticker and oil service sticker (50 × 100 mm portrait by default): logo, title, the facts, a black
 * band with the date that matters, the VIN, a QR. The oil sticker's QR opens WhatsApp to book the next service.
 */
export type PartStickerData = { qr: string; jobNumber: string; name: string; index: number; count: number; date?: string | null };
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
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: `${4.2 * u}mm`, fontWeight: 800, letterSpacing: "0.3px", lineHeight: 1 }}>{d.jobNumber}</div>
            {d.date ? <div style={{ fontSize: `${2.2 * u}mm`, marginTop: `${0.6 * u}mm` }}>{d.date}</div> : null}
          </div>
        </div>
      </div>
      <div style={{ width: "100%", flex: "none", background: "#000", color: "#fff", padding: `${1 * u}mm ${1.5 * u}mm`, fontSize: `${2.7 * u}mm`, fontWeight: 800, textTransform: "uppercase", display: "flex", justifyContent: "space-between", gap: `${2 * u}mm`, lineHeight: 1.15, letterSpacing: "0.2px" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
        <span style={{ whiteSpace: "nowrap", flex: "none" }}>{d.index} OF {d.count}</span>
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
  return `@page { size: ${w}mm ${h}mm; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; } .bar { font-family: Arial, Helvetica, sans-serif; background: #111; color: #fff; padding: 10px 14px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 14px; } .bar a, .bar button { color: #fff; } .print-one { font: 700 12px Arial, Helvetica, sans-serif; margin: 6px 8px; padding: 5px 10px; border: 1px solid #111; background: #fff; border-radius: 6px; cursor: pointer; } @media print { .bar, .print-one { display: none; } body.printing-one .one:not(.print-this) { display: none; } }`;
}
