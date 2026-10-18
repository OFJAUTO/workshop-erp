import "server-only";
import { parseCoords } from "./recovery";

/**
 * Real road distances through the Google Routes API (never a straight line). The key lives in the Vercel
 * environment variable GOOGLE_MAPS_API_KEY; without it every lookup quietly answers null and the screens
 * ask for the kilometres by hand. Short map links (maps.app.goo.gl) are expanded by following their
 * redirects - map links only, never any other kind of link.
 */

export function routesConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

export type LatLng = { lat: number; lng: number };

/** The coordinates behind a maps link: read straight off a long link, or found by following a short link's redirects. */
export async function expandMapLink(url: string | null | undefined): Promise<LatLng | null> {
  const s = String(url ?? "").trim();
  if (!s) return null;
  const direct = parseCoords(s);
  if (direct) return direct;
  let current = s;
  for (let hop = 0; hop < 4; hop++) {
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", cache: "no-store" });
    } catch {
      return null;
    }
    const next = res.headers.get("location");
    if (next) {
      const abs = next.startsWith("http") ? next : new URL(next, current).toString();
      const found = parseCoords(abs);
      if (found) return found;
      current = abs;
      continue;
    }
    // The final page: the coordinates often sit inside the HTML (Google short links).
    if (res.ok) {
      const text = await res.text().catch(() => "");
      const m = /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(text) ?? /center=(-?\d{1,2}\.\d+)%2C(-?\d{1,3}\.\d+)/.exec(text);
      if (m) {
        const lat = Number(m[1]);
        const lng = Number(m[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
      }
    }
    return null;
  }
  return null;
}

/** One-way road kilometres from A to B (Google Routes API); null when the key is missing or the route fails. */
export async function roadKm(from: LatLng, to: LatLng): Promise<number | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.distanceMeters" },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "DRIVE",
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as { routes?: { distanceMeters?: number }[] } | null;
    const m = j?.routes?.[0]?.distanceMeters;
    return typeof m === "number" && m > 0 ? Math.round(m / 100) / 10 : null;
  } catch {
    return null;
  }
}

/** The workshop's own pin from Settings, expanded if it is a short link. */
export async function workshopPin(settings: { workshop_location_pin?: unknown }): Promise<LatLng | null> {
  return expandMapLink(String(settings.workshop_location_pin ?? ""));
}

/**
 * A trip's one-way road distance: pick-up = customer pin → OFJ; delivery = OFJ → customer pin.
 * Null when the pin or the key is missing: the Recovery page then asks for the kilometres by hand.
 */
export async function tripRoadKm(trip: { kind: string; lat: number | null; lng: number | null }, home: LatLng | null): Promise<number | null> {
  if (!home || trip.lat === null || trip.lng === null) return null;
  const pin = { lat: trip.lat, lng: trip.lng };
  return trip.kind === "pickup" ? roadKm(pin, home) : roadKm(home, pin);
}
