/**
 * Recovery trips (pick-ups and deliveries by our truck or an outside company): the map pin, the rough distance,
 * the driver's message and the schedule words. Pure rules; the server side lives in src/lib/delivery.ts.
 */

import { cleanCompanyName, formatPhone } from "./messages";

const MAP_HOSTS = ["google.com", "www.google.com", "maps.google.com", "goo.gl", "maps.app.goo.gl", "maps.apple.com", "wa.me"];

/** A pasted customer pin: a Google (or Apple) Maps link, long or short. */
export function isMapLink(url: string | null | undefined): boolean {
  const s = String(url ?? "").trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.host.toLowerCase();
    if (!MAP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return false;
    if (host.includes("google.com") && !host.startsWith("maps.")) return u.pathname.startsWith("/maps") || u.searchParams.has("q");
    return true;
  } catch {
    return false;
  }
}

/** The coordinates inside a long maps link ("@25.1,55.2" or "q=25.1,55.2"); a short link keeps them to itself. */
export function parseCoords(url: string | null | undefined): { lat: number; lng: number } | null {
  const s = String(url ?? "");
  const m = /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(s) ?? /[?&]q=(-?\d{1,2}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i.exec(s) ?? /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(s);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** Straight-line distance in km (no paid map service; roads make the real drive longer). */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export const SLOT_LABELS: Record<string, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

/** "Sat 18 Oct, afternoon" or "Sat 18 Oct, 16:30" from the chips. */
export function scheduleWords(date: string | null | undefined, slot: string | null | undefined): string {
  const d = date ? new Date(`${date}T12:00:00Z`) : null;
  const day = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "";
  const t = slot ? (SLOT_LABELS[slot] ?? slot) : "";
  return [day, t ? t.toLowerCase() === t ? t : t : ""].filter(Boolean).join(", ") || "time to be agreed";
}

/** The driver's message: a bold heading, the car, the customer with a tidy mobile, the pin and his one-button link, both short. */
export function driverMessage(t: { plate: string; car: string; kind: "delivery" | "pickup"; date: string | null; slot: string | null; customerName: string | null; customerPhone: string | null; locationUrl: string | null; locationDetails: string | null }, links: { drive: string; map: string | null }): string {
  const d = t.date ? new Date(`${t.date}T12:00:00Z`) : null;
  const day = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "";
  const slot = t.slot ? (SLOT_LABELS[t.slot] ?? t.slot) : "";
  const heading = [t.kind === "pickup" ? "Pick-up" : "Delivery", day, slot].filter(Boolean).join(" · ").toUpperCase();
  const where = [t.locationDetails, links.map ?? (links.map === null && t.locationUrl ? t.locationUrl : null)].filter(Boolean).join(" ");
  return [
    `*${heading}*`,
    t.plate || null,
    t.car || null,
    "",
    `*Customer:* ${cleanCompanyName(t.customerName) || "-"}`,
    `*Mobile:* ${formatPhone(t.customerPhone) || "-"}`,
    where ? `*Location:* ${where}` : null,
    "",
    `*When ${t.kind === "pickup" ? "loaded" : "delivered"}, tap:* ${links.drive}`,
  ].filter((x) => x !== null).join("\n");
}

/** The owner's template with the blanks filled; the advisor may still tweak the text for one customer. */
export function onTheWayMessage(template: string, f: { name: string; car: string; truckPlate: string; driverName: string; driverMobile: string }): string {
  return String(template || "")
    .replaceAll("[name]", f.name)
    .replaceAll("[car]", f.car)
    .replaceAll("[truck plate]", f.truckPlate || "-")
    .replaceAll("[driver name]", f.driverName || "-")
    .replaceAll("[driver mobile]", formatPhone(f.driverMobile) || "-");
}

/** "Usual for this distance: AED X–Y" from our own history: trips within ±25% of the distance, at least three of them. */
export function usualRange(km: number, history: { km: number | null; price: number | null }[]): { low: number; high: number; n: number } | null {
  if (!(km > 0)) return null;
  const near = history.filter((h) => h.km !== null && h.price !== null && h.price > 0 && Math.abs(h.km - km) <= km * 0.25).map((h) => h.price as number).sort((a, b) => a - b);
  if (near.length < 3) return null;
  return { low: Math.round(near[Math.floor((near.length - 1) * 0.25)]), high: Math.round(near[Math.ceil((near.length - 1) * 0.75)]), n: near.length };
}
