import "server-only";

/**
 * Autel scanners email a LINK instead of attaching the report. The link is followed straight away
 * (they expire) - but ONLY while every hop stays on autel.com or auteltech.com, with a 20-second
 * limit per request and a 35 MB cap. A PDF is kept as it is; a web page is kept as the page itself
 * after one look inside it for the real PDF. No other link from any email is ever followed.
 */

const MAX_BYTES = 35 * 1024 * 1024;
const HOP_LIMIT = 5;

const hostOk = (h: string) => h === "autel.com" || h === "auteltech.com" || h.endsWith(".autel.com") || h.endsWith(".auteltech.com");

/** The sender is Autel (noreply-…@auteltech.com and friends). */
export const isAutelSender = (from: string | null | undefined) => /@[\w.-]*autel(?:tech)?\.com\b/i.test(String(from ?? ""));

/** The Autel links inside an email's subject and body - at most two, nothing off their domains. */
export function autelLinksIn(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    try {
      const u = new URL(m[0]);
      if (hostOk(u.hostname.toLowerCase())) out.push(u.toString());
    } catch {
      // not a real address
    }
  }
  return [...new Set(out)].slice(0, 2);
}

export type AutelFetch = { bytes: Buffer; contentType: "application/pdf" | "text/html"; fileName: string; finalUrl: string } | { error: string };

async function fetchOnce(url: string): Promise<Response | { error: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    return await fetch(url, { redirect: "manual", cache: "no-store", signal: ctl.signal });
  } catch (e) {
    return { error: `Could not reach Autel: ${String(e).slice(0, 120)}` };
  } finally {
    clearTimeout(t);
  }
}

/** Follows the link (autel.com / auteltech.com only, redirects included) and brings the report back. */
export async function fetchAutelReport(url: string, depth = 0): Promise<AutelFetch> {
  let current = url;
  for (let hop = 0; hop < HOP_LIMIT; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return { error: "The link is not a valid address" };
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Not a web link" };
    if (!hostOk(u.hostname.toLowerCase())) return { error: `Refused: ${u.hostname} is not an Autel address` };
    const res = await fetchOnce(current);
    if ("error" in res) return res;
    const loc = res.headers.get("location");
    if (loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) return { error: `Autel answered ${res.status}` };
    if (Number(res.headers.get("content-length") || 0) > MAX_BYTES) return { error: "The report is too large (over 35 MB)" };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) return { error: "The report is too large (over 35 MB)" };
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const cd = res.headers.get("content-disposition") ?? "";
    const nameRaw = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd)?.[1] ?? (u.pathname.split("/").pop() || "autel-report");
    let fileName = "autel-report";
    try {
      fileName = decodeURIComponent(nameRaw).replace(/["\\]/g, "").trim() || "autel-report";
    } catch {
      fileName = nameRaw.replace(/["\\]/g, "").trim() || "autel-report";
    }
    if (ct.includes("pdf") || bytes.subarray(0, 5).toString() === "%PDF-") {
      return { bytes, contentType: "application/pdf", fileName: /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`, finalUrl: current };
    }
    if (ct.includes("text/html")) {
      // The page, not the PDF: one look inside for the real report on an Autel address.
      if (depth < 1) {
        const html = bytes.toString("utf8");
        const inner = [...html.matchAll(/https?:\/\/[^\s<>"'\\]+/g)].map((m) => m[0]).find((l) => {
          try {
            const lu = new URL(l);
            return hostOk(lu.hostname.toLowerCase()) && /\.pdf|pdf-report|download/i.test(l);
          } catch {
            return false;
          }
        });
        if (inner) {
          const got = await fetchAutelReport(inner, depth + 1);
          if ("bytes" in got) return got;
        }
      }
      // Keep the page itself so nothing is lost when the link later expires.
      return { bytes, contentType: "text/html", fileName: /\.html?$/i.test(fileName) ? fileName : `${fileName}.html`, finalUrl: current };
    }
    return { error: `Unexpected content from Autel (${ct || "unknown type"})` };
  }
  return { error: "Too many redirects" };
}

/** "2011 Porsche" out of "Please receive 2011 Porsche Vehicle Diagnostic Report (Report ID: …)". */
export function carHintOf(subject: string): string | null {
  const m = /(\d{4})\s+([A-Za-z][A-Za-z -]{2,30}?)\s+Vehicle/i.exec(subject) ?? /receive\s+(\d{4})\s+([A-Za-z][A-Za-z -]{2,30})/i.exec(subject);
  return m ? `${m[1]} ${m[2].trim()}` : null;
}

/** The Report ID out of the subject or body. */
export function reportIdOf(text: string): string | null {
  return /Report ID:\s*([A-Z0-9_-]{4,40})/i.exec(text)?.[1] ?? null;
}
