/**
 * The three stickers as plain HTML, black on white, sized in millimetres: the part sticker (logo,
 * QR, date, last 8 of the VIN), the battery warranty sticker and the oil service sticker. Used by the
 * print pages and the live preview in Settings. No styles from the app: these print bare.
 */
export type PartStickerData = { qr: string; date: string; vin8: string };
export type BatteryStickerData = { qr: string; installed: string; until: string; vin: string; title: string; valid: string };
export type ServiceStickerData = { qr: string; servicedOn: string; mileage: string; nextDate: string; nextMileage: string; vin: string; title: string; band: string; phone: string | null };

const base = (w: number, h: number): React.CSSProperties => ({ width: `${w}mm`, height: `${h}mm`, boxSizing: "border-box", overflow: "hidden", background: "#fff", color: "#000", fontFamily: "Arial, Helvetica, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: "1mm", pageBreakAfter: "always", breakAfter: "page" });

export function PartSticker({ w, h, logoUrl, d }: { w: number; h: number; logoUrl: string; d: PartStickerData }) {
  const qr = Math.min(w, h) * 0.5;
  return (
    <div style={base(w, h)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt="" style={{ height: `${h * 0.16}mm`, maxWidth: `${w * 0.8}mm`, objectFit: "contain" }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={d.qr} alt="" style={{ width: `${qr}mm`, height: `${qr}mm` }} />
      <div style={{ fontSize: `${Math.max(1.6, h * 0.09)}mm`, fontWeight: 700, lineHeight: 1.15, textAlign: "center" }}>
        <div>{d.date}</div>
        <div style={{ letterSpacing: "0.3px" }}>{d.vin8}</div>
      </div>
    </div>
  );
}

export function BatterySticker({ size, logoUrl, d }: { size: number; logoUrl: string; d: BatteryStickerData }) {
  const fs = size / 60;
  return (
    <div style={{ ...base(size, size), padding: `${2 * fs}mm`, justifyContent: "flex-start", gap: `${1.2 * fs}mm` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt="" style={{ height: `${8 * fs}mm`, maxWidth: `${44 * fs}mm`, objectFit: "contain" }} />
      <div style={{ fontSize: `${4.2 * fs}mm`, fontWeight: 800, letterSpacing: "0.4px", textTransform: "uppercase" }}>{d.title}</div>
      <div style={{ display: "flex", width: "100%", gap: `${2 * fs}mm`, alignItems: "center" }}>
        <div style={{ flex: 1, fontSize: `${3 * fs}mm`, lineHeight: 1.35 }}>
          <div><span style={{ fontWeight: 400 }}>Installed</span><br /><b>{d.installed}</b></div>
          <div style={{ marginTop: `${1 * fs}mm` }}><span style={{ fontWeight: 400 }}>Warranty until</span><br /><b>{d.until}</b></div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.qr} alt="" style={{ width: `${22 * fs}mm`, height: `${22 * fs}mm` }} />
      </div>
      <div style={{ fontSize: `${2.6 * fs}mm`, fontWeight: 700, letterSpacing: "0.3px", wordBreak: "break-all", textAlign: "center" }}>{d.vin}</div>
      <div style={{ fontSize: `${2.4 * fs}mm`, textAlign: "center", marginTop: "auto" }}>{d.valid}</div>
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
  return `@page { size: ${w}mm ${h}mm; margin: 0; } html, body { margin: 0; background: #fff; } .bar { font-family: Arial, Helvetica, sans-serif; background: #111; color: #fff; padding: 10px 14px; display: flex; gap: 12px; align-items: center; font-size: 14px; } .bar a, .bar button { color: #fff; } @media print { .bar { display: none; } }`;
}
