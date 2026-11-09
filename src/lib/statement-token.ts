import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * The customer's statement and combined bill links (9 November 2026, Section 3): a signed token (no table), so a
 * statement is always today's figures. Kind "statement" = every open job, invoice, payment and pending cheque of the
 * customer; kind "combined" = ONE bill over the chosen open proformas of several cars (each car keeps its own tax
 * invoice when paid), with an optional pasted payment link. 60 days.
 */

export type StatementGrant = { c: string; k: "statement" | "combined"; d?: string[]; l?: string | null };
const DAYS = 60;

function key(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("No signing secret");
  return createHmac("sha256", "erp-statement-v1").update(secret).digest();
}

export function signStatement(g: StatementGrant): string {
  const exp = Math.floor(Date.now() / 1000) + DAYS * 86400;
  const body = Buffer.from(JSON.stringify({ ...g, exp })).toString("base64url");
  const sig = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readStatement(token: string): StatementGrant | null {
  const [body, sig] = String(token ?? "").split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", key()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const g = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatementGrant & { exp: number };
    if (!g.c || !g.exp || g.exp < Date.now() / 1000) return null;
    return { c: g.c, k: g.k === "combined" ? "combined" : "statement", d: Array.isArray(g.d) ? g.d.map(String) : undefined, l: g.l ?? null };
  } catch {
    return null;
  }
}
