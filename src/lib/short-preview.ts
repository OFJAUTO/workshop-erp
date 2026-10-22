import "server-only";
import { PRODUCTION_SITE_URL } from "./site";
import { urlOfCode } from "./short-links";

/**
 * What a short link answers. WhatsApp's robot never follows a redirect, so every short link we send
 * answers HTTP 200 with the og: tags in the head (the small square OFJ logo and a short generic title -
 * no names, plates or amounts), then sends the person on with a meta refresh plus a script. The one
 * exception: a target outside our own site (a map pin) stays a plain 302, with no preview of ours.
 */

const DESCRIPTION = "O F J Automotive Works L.L.C · Al Quoz, Dubai";
const IMAGE = `${PRODUCTION_SITE_URL}/og/ofj-square-600.png`;

function titleFor(prefix: string, url: string): string {
  if (prefix === "q") return "OFJ Automotive – Your quotation";
  if (prefix === "i") return "OFJ Automotive – Your invoice";
  if (prefix === "r") return "OFJ Automotive – Your receipt";
  if (prefix === "d") return "OFJ Automotive – Delivery";
  if (url.includes("/approve/") || url.includes("/u/")) return "OFJ Automotive – Your job card";
  if (url.includes("/report/")) return "OFJ Automotive – Your inspection report";
  if (url.includes("/progress/")) return "OFJ Automotive – Your car's progress";
  if (url.includes("/p/")) return "OFJ Automotive – Payment";
  if (url.includes("/handover/")) return "OFJ Automotive – Your handover";
  if (url.includes("/warranty/")) return "OFJ Automotive – Your warranty";
  return "OFJ Automotive";
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The whole response for /q, /i, /r, /m and /d short codes. */
export async function shortLinkResponse(code: string, prefix: "q" | "i" | "r" | "m" | "d", reqUrl: string): Promise<Response> {
  const url = await urlOfCode(code);
  if (!url) return Response.redirect(new URL("/", reqUrl), 302);
  const canonical = `${PRODUCTION_SITE_URL}/${prefix}/${code}`;
  // A target on someone else's site (a Google Maps pin): pass straight through, never dress it as ours.
  if (!url.startsWith(PRODUCTION_SITE_URL) && !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) return Response.redirect(url, 302);
  const title = titleFor(prefix, url);
  const safe = escapeHtml(url);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(DESCRIPTION)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${IMAGE}">
<meta property="og:image:secure_url" content="${IMAGE}">
<meta property="og:image:width" content="600">
<meta property="og:image:height" content="600">
<meta property="og:image:type" content="image/png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="OFJ Automotive">
<meta name="twitter:card" content="summary">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${safe}">
</head>
<body style="margin:0;font-family:system-ui,sans-serif">
<script>window.location.replace(${JSON.stringify(url)})</script>
<p style="padding:24px">Opening… <a href="${safe}">Tap here if nothing happens.</a></p>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
