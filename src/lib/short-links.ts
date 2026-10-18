import "server-only";
import { randomBytes } from "node:crypto";
import { PRODUCTION_SITE_URL } from "./site";
import { createAdminClient } from "./supabase/admin";

/**
 * Short links for everything we send on WhatsApp: erp.ofjauto.com/q/k3X9 instead of a long address. The prefix
 * says what it opens: /q a quotation, /i an invoice or proforma, /r a receipt, /d the driver's one-button page,
 * /m everything else. Every prefix resolves any code; a link is made once per address and reused.
 *
 * Reads pass an abort signal so Next never serves a page's second lookup from its per-request fetch memo (a GET
 * repeated after the insert would otherwise come back empty from the cache); the insert returns its own row.
 */

const SHORT_HOST = PRODUCTION_SITE_URL.replace(/^https?:\/\//, "");
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/l/i/I

function newCode(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** The short address for a URL, e.g. "erp.ofjauto.com/m/k3X9" (made once, reused). kind "drive" serves under /d. */
function prefixFor(url: string, kind: "map" | "page" | "drive"): string {
  if (kind === "drive") return "d";
  if (kind === "map") return "m";
  if (url.includes("/quote/")) return "q";
  if (url.includes("/invoice/") || url.includes("/proforma/")) return "i";
  if (url.includes("/api/pdf/receipt/")) return "r";
  return "m";
}

export async function shortFor(url: string, kind: "map" | "page" | "drive" = "page"): Promise<string> {
  const admin = createAdminClient();
  const prefix = prefixFor(url, kind);
  const { data: existing } = await admin.from("short_links").select("code").eq("url", url).limit(1).abortSignal(new AbortController().signal).maybeSingle();
  if (existing?.code) return `${SHORT_HOST}/${prefix}/${existing.code}`;
  for (let len = 4; len <= 8; len++) {
    // The insert hands the row straight back; a clash on the code tries a longer one.
    const { data: made } = await admin.from("short_links").insert({ code: newCode(len), url, kind }).select("code").maybeSingle();
    if (made?.code) return `${SHORT_HOST}/${prefix}/${made.code}`;
    // A clash on the url means another request just made it: that row wins.
    const { data: race } = await admin.from("short_links").select("code").eq("url", url).limit(1).abortSignal(new AbortController().signal).maybeSingle();
    if (race?.code) return `${SHORT_HOST}/${prefix}/${race.code}`;
  }
  return url; // Never in practice: the long address still works.
}

/** The stored address behind a /m or /d code (the hit is counted); null when the code is unknown. */
export async function urlOfCode(code: string): Promise<string | null> {
  if (!/^[A-Za-z0-9]{3,12}$/.test(code)) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("short_links").select("url, hits").eq("code", code).abortSignal(new AbortController().signal).maybeSingle();
  if (!data?.url) return null;
  admin.from("short_links").update({ hits: (Number(data.hits) || 0) + 1 }).eq("code", code).then(() => null, () => null);
  return data.url as string;
}
