import "server-only";
import { randomBytes } from "node:crypto";
import { PRODUCTION_SITE_URL } from "./site";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type QrKind = "part" | "battery" | "service" | "item";
export type StickerSettings = {
  partW: number;
  partH: number;
  large: number;
  /** The battery warranty sticker (square, mm) and the oil service sticker (square, mm), each set in Settings. */
  battery: number;
  service: number;
  /** Portrait sizes of the battery and oil service stickers. */
  batteryW: number;
  batteryH: number;
  serviceW: number;
  serviceH: number;
  /** The printer names shown on the print pages. */
  printerPart: string;
  printerLarge: string;
  /** The WhatsApp booking link behind the oil service sticker's QR. */
  whatsappNumber: string;
  whatsappText: string;
  partTypes: string[];
  batteryRequired: boolean;
  serviceRequired: boolean;
  warrantyMonths: number;
  warrantyByBrand: Record<string, number>;
  intervalMonths: number;
  intervalKm: number;
  intervalMiles: number;
  servicePhone: boolean;
  logoUrl: string;
  /** A logo the owner uploaded (a path in the files bucket), or empty for the standard file. */
  logoPath: string;
  wording: Record<string, string>;
  phone: string;
};

/** The sticker settings in one object, with the standard values where nothing is set. */
export function stickerSettings(settings: Settings): StickerSettings {
  const w = (settings.sticker_wording ?? {}) as Record<string, string>;
  return {
    partW: Number(settings.sticker_part_width_mm) || 20,
    partH: Number(settings.sticker_part_height_mm) || 20,
    large: Number(settings.sticker_large_mm) || 60,
    battery: Number(settings.sticker_battery_mm) || Number(settings.sticker_large_mm) || 60,
    service: Number(settings.sticker_service_mm) || Number(settings.sticker_large_mm) || 60,
    batteryW: Number(settings.sticker_battery_w_mm) || 50,
    batteryH: Number(settings.sticker_battery_h_mm) || 100,
    serviceW: Number(settings.sticker_service_w_mm) || 50,
    serviceH: Number(settings.sticker_service_h_mm) || 100,
    printerPart: String(settings.sticker_printer_part || "Printer 1 (40 × 30 mm)"),
    printerLarge: String(settings.sticker_printer_large || "Printer 2 (50 × 100 mm)"),
    whatsappNumber: String(settings.sticker_service_whatsapp_number ?? ""),
    whatsappText: String(settings.sticker_service_whatsapp_text || "Hi, I'd like to book a service for [PLATE]"),
    partTypes: Array.isArray(settings.sticker_part_types) ? (settings.sticker_part_types as string[]).map((t) => t.toLowerCase()) : [],
    batteryRequired: settings.sticker_battery_required !== false,
    serviceRequired: settings.sticker_service_required !== false,
    warrantyMonths: Number(settings.battery_warranty_months) || 12,
    warrantyByBrand: (settings.battery_warranty_by_brand ?? {}) as Record<string, number>,
    intervalMonths: Number(settings.service_interval_months) || 12,
    intervalKm: Number(settings.service_interval_km) || 10000,
    intervalMiles: Number(settings.service_interval_miles) || 6000,
    servicePhone: settings.sticker_service_show_phone !== false,
    logoUrl: "/logo.svg",
    logoPath: String(settings.sticker_logo_url || ""),
    wording: { part: "", battery: "Battery warranty", battery_valid: "Valid for this vehicle only", service: "Service", service_band: "Next service, whichever comes first", service_scan: "Scan to book your next service on WhatsApp", ...w },
    phone: String(settings.company_phone ?? ""),
  };
}

export { isBatteryPart } from "./battery";

/** The WhatsApp link behind the oil service sticker's QR: the Settings number (else the company phone) and the message with the plate filled in. */
export function serviceWhatsAppUrl(ss: StickerSettings, plate: string): string {
  const digits = (ss.whatsappNumber || ss.phone || "").replace(/\D/g, "");
  const text = ss.whatsappText.replaceAll("[PLATE]", plate.trim() || "my car");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Warranty length: the months chosen on the part's line, else Settings per brand, else the standard length. */
export function warrantyMonthsFor(ss: StickerSettings, brand: string | null | undefined, partMonths?: number | null): number {
  if (partMonths && partMonths > 0) return Math.round(partMonths);
  const b = (brand ?? "").trim().toLowerCase();
  if (b) for (const [k, v] of Object.entries(ss.warrantyByBrand)) if (k.trim().toLowerCase() === b && Number(v) > 0) return Number(v);
  return ss.warrantyMonths;
}

/** A short code for a QR: eight letters and digits that scan easily, no confusing characters. */
export function newQrCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export const qrUrl = (code: string) => `${PRODUCTION_SITE_URL}/s/${code}`;

/** The short link behind a sticker's QR: one per record, reused on a reprint. */
export async function ensureQrLink(kind: QrKind, ref: { jobId?: string | null; vehicleId?: string | null; refId?: string | null }, by: string | null): Promise<string> {
  const admin = createAdminClient();
  if (ref.refId) {
    const { data: existing } = await admin.from("qr_links").select("code").eq("kind", kind).eq("ref_id", ref.refId).limit(1).maybeSingle();
    if (existing?.code) return existing.code as string;
  }
  for (let i = 0; i < 5; i++) {
    const code = newQrCode();
    const { error } = await admin.from("qr_links").insert({ code, kind, job_id: ref.jobId ?? null, vehicle_id: ref.vehicleId ?? null, ref_id: ref.refId ?? null, created_by: by });
    if (!error) return code;
  }
  throw new Error("Could not make a QR link.");
}

export type ServiceStickerData = { serviced_on: string; mileage: number | null; mileage_unit: "km" | "miles"; next_date: string; next_mileage: number | null; printed_at?: string | null; printed_by?: string | null; qr_code?: string | null };

const addMonths = (iso: string, months: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/** The service sticker's numbers, filled in by the rules unless already saved on the job. */
export function serviceStickerDefaults(ss: StickerSettings, job: { work_started_at?: string | null; plan_released_at?: string | null; gated_in_at?: string | null; service_sticker?: unknown }, gateIn: { mileage?: number | null; mileage_unit?: string | null } | null, today: string): ServiceStickerData {
  const saved = job.service_sticker as ServiceStickerData | null | undefined;
  if (saved && saved.serviced_on) return saved;
  const started = (job.work_started_at ?? job.plan_released_at ?? job.gated_in_at ?? today).slice(0, 10);
  const unit: "km" | "miles" = gateIn?.mileage_unit === "miles" ? "miles" : "km";
  const mileage = gateIn?.mileage ?? null;
  return {
    serviced_on: started,
    mileage,
    mileage_unit: unit,
    next_date: addMonths(started, ss.intervalMonths),
    next_mileage: mileage === null ? null : mileage + (unit === "miles" ? ss.intervalMiles : ss.intervalKm),
  };
}

/** Does this job include an oil change? Marked services first, then the words on the approved lines. */
export async function jobHasOilChange(jobId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: qs } = await admin.from("quotations").select("id").eq("job_id", jobId).eq("status", "approved").eq("is_active", true);
  const ids = (qs ?? []).map((q) => q.id);
  if (!ids.length) return false;
  const { data: lines } = await admin.from("quotation_lines").select("title, service_id, line_type").in("quotation_id", ids).eq("is_active", true);
  const sids = (lines ?? []).map((l) => l.service_id).filter((x): x is string => !!x);
  if (sids.length) {
    const { data: svcs } = await admin.from("services").select("id, includes_oil_change").in("id", sids);
    if ((svcs ?? []).some((s) => s.includes_oil_change)) return true;
  }
  return (lines ?? []).some((l) => (l.line_type === "labour" || l.line_type === "package") && /\boil\b.*\b(change|service)\b|\b(change|service)\b.*\boil\b/i.test(l.title ?? ""));
}

/** The emblem alone (public/logo-mark.svg) for the 20 mm part sticker, where the full logo would be unreadable. */
export async function stickerMarkDataUrl(): Promise<string> {
  try {
    const svg = await readFile(path.join(process.cwd(), "public", "logo-mark.svg"));
    return `data:image/svg+xml;base64,${svg.toString("base64")}`;
  } catch {
    return "/logo-mark.svg";
  }
}

/** The sticker logo as a data address, so a print page or a preview needs no second request: the uploaded file, else the standard logo. */
export async function stickerLogoDataUrl(ss: StickerSettings): Promise<string> {
  if (ss.logoPath) {
    const { data } = await createAdminClient().storage.from("job-files").download(ss.logoPath);
    if (data) {
      const type = ss.logoPath.endsWith(".svg") ? "image/svg+xml" : ss.logoPath.endsWith(".png") ? "image/png" : "image/jpeg";
      return `data:${type};base64,${Buffer.from(await data.arrayBuffer()).toString("base64")}`;
    }
  }
  try {
    const svg = await readFile(path.join(process.cwd(), "public", "logo.svg"));
    return `data:image/svg+xml;base64,${svg.toString("base64")}`;
  } catch {
    return "/logo.svg";
  }
}
