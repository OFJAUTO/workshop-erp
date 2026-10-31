import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A sending permit for one place (31 October 2026, uploads section 10): handed to the browser while the person IS allowed
 * to add files there, kept with each photo or video waiting on the device, and accepted by /api/uploads/prepare and
 * /api/uploads/register instead of the session. So a file taken in a basement still arrives after the shared tablet's
 * idle lock signed the person out, after the 30-minute phone link ran out, or from the PIN-only section tablet - always
 * recorded under the person who took it. Signed with a key made from the server's secret; it never leaves the place it
 * names, and it runs out after `GRANT_HOURS`.
 */
export type UploadTarget = "gate_in" | "inspection" | "job_file" | "supplier_proof" | "commission_proof" | "credit_note" | "loose_item";

export type UploadGrant = {
  /** The place: which kind of upload and its id (a job, an inspection, an LPO, a payment, a part). */
  t: UploadTarget;
  s: string;
  /** The person the files are recorded under (null only for an old phone link without a maker). */
  u: string | null;
  /** How the permission was proved when the permit was made. */
  via: "login" | "link" | "pin";
  iat: number;
  exp: number;
};

export const GRANT_HOURS = 12;

function key(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("The server secret is missing.");
  return createHmac("sha256", "erp-upload-grant-v1").update(secret).digest();
}

export function mintGrant(g: Omit<UploadGrant, "iat" | "exp">, hours = GRANT_HOURS): { grant: string; expiresAt: number } {
  const iat = Date.now();
  const exp = iat + hours * 3_600_000;
  const body = Buffer.from(JSON.stringify({ ...g, iat, exp })).toString("base64url");
  const sig = createHmac("sha256", key()).update(body).digest("base64url");
  return { grant: `${body}.${sig}`, expiresAt: exp };
}

/** The permit, when it is genuine, unexpired and for exactly this place; otherwise null. */
export function readGrant(token: unknown, target: UploadTarget, scopeId: string, now = Date.now()): UploadGrant | null {
  const g = readGrantAnyTime(token, target, scopeId);
  return g && g.exp >= now ? g : null;
}

/** A genuine permit for exactly this place, whether or not it has run out (to say why a file cannot be sent any more). */
export function readGrantAnyTime(token: unknown, target: UploadTarget, scopeId: string): UploadGrant | null {
  if (typeof token !== "string" || token.length > 4000) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let want: Buffer;
  try {
    want = createHmac("sha256", key()).update(body).digest();
  } catch {
    return null;
  }
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let g: UploadGrant;
  try {
    g = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UploadGrant;
  } catch {
    return null;
  }
  if (!g || g.t !== target || g.s !== scopeId || typeof g.exp !== "number" || typeof g.iat !== "number") return null;
  return g;
}
