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

export type RoadResult = { km: number | null; error: string | null };

/** One-way road kilometres from A to B (Google Routes API), with the reason when it fails - never the key. */
export async function roadKmDetail(from: LatLng, to: LatLng): Promise<RoadResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { km: null, error: "GOOGLE_MAPS_API_KEY is not set on the server" };
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
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let reason = `Google answered ${res.status}`;
      try {
        const j = JSON.parse(body) as { error?: { message?: string; status?: string } };
        if (j?.error?.status) reason += ` ${j.error.status}`;
        if (j?.error?.message) reason += `: ${String(j.error.message).slice(0, 240)}`;
      } catch { /* the status alone */ }
      return { km: null, error: reason };
    }
    const j = (await res.json().catch(() => null)) as { routes?: { distanceMeters?: number }[] } | null;
    const m = j?.routes?.[0]?.distanceMeters;
    return typeof m === "number" && m > 0 ? { km: Math.round(m / 100) / 10, error: null } : { km: null, error: "Google found no driving route between the two points" };
  } catch (e) {
    return { km: null, error: `Could not reach Google: ${String(e).slice(0, 160)}` };
  }
}

/** One-way road kilometres; null when the lookup fails (the detail version says why). */
export async function roadKm(from: LatLng, to: LatLng): Promise<number | null> {
  return (await roadKmDetail(from, to)).km;
}

/** The workshop's own pin from Settings, expanded if it is a short link. */
export async function workshopPin(settings: { workshop_location_pin?: unknown }): Promise<LatLng | null> {
  return expandMapLink(String(settings.workshop_location_pin ?? ""));
}

/**
 * A trip's one-way road distance: pick-up = customer pin → OFJ; delivery = OFJ → customer pin.
 * The error says why when it fails; the Recovery page then asks for the kilometres by hand.
 */
export async function tripRoadKmDetail(trip: { kind: string; lat: number | null; lng: number | null }, home: LatLng | null): Promise<RoadResult> {
  if (trip.lat === null || trip.lng === null) return { km: null, error: "The customer pin has no coordinates" };
  if (!home) return { km: null, error: "The workshop's own pin is not set in Settings" };
  const pin = { lat: trip.lat, lng: trip.lng };
  return trip.kind === "pickup" ? roadKmDetail(pin, home) : roadKmDetail(home, pin);
}

export async function tripRoadKm(trip: { kind: string; lat: number | null; lng: number | null }, home: LatLng | null): Promise<number | null> {
  return (await tripRoadKmDetail(trip, home)).km;
}
