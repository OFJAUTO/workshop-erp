import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

let logoCache: Buffer | null = null;

/** The company logo from docs/ofj-logo.svg (served as /logo.svg), drawn sharp at print size for the header of every PDF. */
export async function loadLogo(): Promise<Buffer | null> {
  if (logoCache) return logoCache;
  try {
    const svg = await fs.readFile(path.join(process.cwd(), "public", "logo.svg"));
    logoCache = await sharp(svg, { density: 300 }).resize({ height: 480, fit: "inside" }).png().toBuffer();
    return logoCache;
  } catch {
    try {
      logoCache = await fs.readFile(path.join(process.cwd(), "public", "logo.jpg"));
      return logoCache;
    } catch {
      return null;
    }
  }
}

/** A photo fetched from storage and shrunk for the PDF (phones take 3 to 5 MB each); null when it cannot be read. */
export async function fetchPhoto(url: string | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    return await sharp(raw).rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
  } catch {
    return null;
  }
}
