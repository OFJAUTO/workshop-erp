/**
 * The three stickers as plain HTML, black on white, sized in millimetres: the part sticker (logo,
 * QR, date, last 8 of the VIN), the battery warranty sticker and the oil service sticker. Used by the
 * print pages and the live preview in Settings. No styles from the app: these print bare.
 */
export type PartStickerData = { qr: string; date: string; vin8: string };
export type BatteryStickerData = { qr: string; installed: string; until: string; vin: string; title: string; valid: string; /** Which battery: "Main battery · Varta AGM 95Ah" or "Auxiliary battery". */ line: string };

/** The line that says which battery the sticker is for, from the part's description, brand and model. */
export function batteryLine(description: string | null | undefined, brand?: string | null, model?: string | null) {
  const which = /aux/i.test(description ?? "") ? "Auxiliary battery" : "Main battery";
  return [which, [brand, model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
}
export type ServiceStickerData = { qr: string; servicedOn: string; mileage: string; nextDate: string; nextMileage: string; vin: string; title: string; band: string; phone: string | null };

const base = (w: number, h: number): React.CSSProperties => ({ width: `${w}mm`, height: `${h}mm`, boxSizing: "border-box", overflow: "hidden", background: "#fff", color: "#000", fontFamily: "Arial, Helvetica, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: "1mm", pageBreakAfter: "always", breakAfter: "page" });

export function PartSticker({ w, h, logoUrl, d }: { w: number; h: number; logoUrl: string; d: PartStickerData }) {
  const qr = Math.min(w, h) * 0.5;
  return (
    <div style={base(w, h)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt="" style={{ height: `${h * 0.2}mm`, maxWidth: `${w * 0.8}mm`, objectFit: "contain" }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={d.qr} alt="" style={{ width: `${qr}mm`, height: `${qr}mm` }} />
      <div style={{ fontSize: `${Math.max(1.6, h * 0.09)}mm`, fontWeight: 700, lineHeight: 1.15, textAlign: "center" }}>
        <div>{d.date}</div>
        <div style={{ letterSpacing: "0.3px" }}>{d.vin8}</div>
      </div>
    </div>
  );
}

/** Logo, title, which battery, installed date beside the QR, "Warranty until" in a black band, the VIN large with "Valid for this vehicle only" under it. Even gaps, nothing large. */
export function BatterySticker({ size, logoUrl, d }: { size: number; logoUrl: string; d: BatteryStickerData }) {
  const fs = size / 60;
  return (
    <div style={{ ...base(size, size), padding: `${2 * fs}mm`, justifyContent: "space-between", gap: `${0.8 * fs}mm` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt="" style={{ height: `${6 * fs}mm`, maxWidth: `${44 * fs}mm`, objectFit: "contain" }} />
      <div style={{ fontSize: `${3.4 * fs}mm`, fontWeight: 800, letterSpacing: "0.4px", textTransform: "uppercase", textAlign: "center" }}>{d.title}</div>
      <div style={{ fontSize: `${2.8 * fs}mm`, fontWeight: 700, textAlign: "center" }}>{d.line}</div>
      <div style={{ display: "flex", width: "100%", gap: `${2 * fs}mm`, alignItems: "center" }}>
        <div style={{ flex: 1, fontSize: `${2.8 * fs}mm`, lineHeight: 1.35 }}>
          <div>Installed</div>
          <div style={{ fontWeight: 700 }}>{d.installed}</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.qr} alt="" style={{ width: `${16 * fs}mm`, height: `${16 * fs}mm` }} />
      </div>
      <div style={{ width: "100%", background: "#000", color: "#fff", padding: `${1.2 * fs}mm ${1.5 * fs}mm`, textAlign: "center" }}>
        <div style={{ fontSize: `${2.4 * fs}mm`, letterSpacing: "0.4px", textTransform: "uppercase" }}>Warranty until</div>
        <div style={{ fontSize: `${4.6 * fs}mm`, fontWeight: 800, marginTop: `${0.3 * fs}mm` }}>{d.until}</div>
      </div>
      <div style={{ fontSize: `${3.4 * fs}mm`, fontWeight: 800, letterSpacing: "0.5px", wordBreak: "break-all", textAlign: "center" }}>{d.vin}</div>
      <div style={{ fontSize: `${2.4 * fs}mm`, textAlign: "center" }}>{d.valid}</div>
    </div>
  );
}

export function ServiceSticker({ size, logoUrl, d }: { size: number; logoUrl: string; d: ServiceStickerData }) {
  const fs = size / 60;
  return (
    <div style={{ ...base(size, size), padding: `${2 * fs}mm`, justifyContent: "flex-start", gap: `${1 * fs}mm` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt="" style={{ height: `${7 * fs}mm`, maxWidth: `${44 * fs}mm`, objectFit: "contain" }} />
      <div style={{ fontSize: `${4 * fs}mm`, fontWeight: 800, letterSpacing: "0.4px", textTransform: "uppercase" }}>{d.title}</div>
      <div style={{ fontSize: `${2.8 * fs}mm`, textAlign: "center", lineHeight: 1.3 }}>Serviced on <b>{d.servicedOn}</b>{d.mileage ? <> at <b>{d.mileage}</b></> : null}</div>
      <div style={{ width: "100%", background: "#000", color: "#fff", padding: `${1.2 * fs}mm ${1.5 * fs}mm`, textAlign: "center" }}>
        <div style={{ fontSize: `${2.3 * fs}mm`, letterSpacing: "0.3px", textTransform: "uppercase" }}>{d.band}</div>
        <div style={{ fontSize: `${3.4 * fs}mm`, fontWeight: 800, marginTop: `${0.5 * fs}mm` }}>{d.nextDate}{d.nextMileage ? `  ·  ${d.nextMileage}` : ""}</div>
      </div>
      <div style={{ display: "flex", width: "100%", gap: `${2 * fs}mm`, alignItems: "center", marginTop: "auto" }}>
        <div style={{ flex: 1, fontSize: `${2.3 * fs}mm`, lineHeight: 1.35 }}>
          <div style={{ fontWeight: 700, wordBreak: "break-all" }}>{d.vin}</div>
          {d.phone ? <div style={{ marginTop: `${0.8 * fs}mm` }}>{d.phone}</div> : null}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.qr} alt="" style={{ width: `${17 * fs}mm`, height: `${17 * fs}mm` }} />
      </div>
    </div>
  );
}

/** The one style tag every sticker print page needs: the page is the sticker. */
export function stickerPageCss(w: number, h: number) {
  return `@page { size: ${w}mm ${h}mm; margin: 0; } html, body { margin: 0; background: #fff; } .bar { font-family: Arial, Helvetica, sans-serif; background: #111; color: #fff; padding: 10px 14px; display: flex; gap: 12px; align-items: center; font-size: 14px; } .bar a, .bar button { color: #fff; } @media print { .bar { display: none; } } .print-one { font: 700 12px Arial, Helvetica, sans-serif; margin: 6px 8px; padding: 5px 10px; border: 1px solid #111; background: #fff; border-radius: 6px; cursor: pointer; } @media print { .print-one { display: none; } body.printing-one .one:not(.print-this) { display: none; } }`;
}
