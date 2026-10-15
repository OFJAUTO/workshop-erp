import { NextResponse, type NextRequest } from "next/server";
import { pdfPageCount, renderPdfPage } from "@/lib/pdf-read";

/**
 * The pages of one of our own PDFs as pictures, for the viewer inside the customer links:
 *   /api/pdf-pages?src=/api/pdf/quote/<token>&info=1   → { pages }
 *   /api/pdf-pages?src=/api/pdf/quote/<token>&page=1   → PNG of that page
 * Only our own PDF routes are accepted. The PDF is fetched once and kept for a few minutes.
 */
const ALLOWED = /^\/api\/pdf\/(quote|report|invoice|warranty|lpo)\/[A-Za-z0-9_-]{8,}$/;
const cache = new Map<string, { at: number; bytes: Buffer }>();
const TTL = 5 * 60 * 1000;

async function pdfBytes(origin: string, src: string): Promise<Buffer | null> {
  const hit = cache.get(src);
  if (hit && Date.now() - hit.at < TTL) return hit.bytes;
  const res = await fetch(`${origin}${src}`, { cache: "no-store" });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  cache.set(src, { at: Date.now(), bytes });
  return bytes;
}

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const src = p.get("src") ?? "";
  if (!ALLOWED.test(src)) return NextResponse.json({ error: "Not one of our documents." }, { status: 400 });
  const bytes = await pdfBytes(request.nextUrl.origin, src);
  if (!bytes) return NextResponse.json({ error: "The document could not be read." }, { status: 404 });
  if (p.get("info")) return NextResponse.json({ pages: await pdfPageCount(bytes) }, { headers: { "Cache-Control": "private, max-age=300" } });
  const page = Math.max(1, Number(p.get("page")) || 1);
  const png = await renderPdfPage(bytes, page - 1, Math.min(3, Math.max(1, Number(p.get("scale")) || 2)));
  if (!png) return NextResponse.json({ error: "No such page." }, { status: 404 });
  return new NextResponse(new Uint8Array(png), { headers: { "content-type": "image/png", "Cache-Control": "private, max-age=300" } });
}
