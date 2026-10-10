import type { Metadata } from "next";
import { PRODUCTION_SITE_URL } from "./site";

/**
 * The standard for every page a customer opens from a WhatsApp link (approval, inspection report,
 * quotations, estimates, invoices, receipts): the preview always shows the logo, a title and a
 * one-line description, never just the web address. Customers never see the words "Workshop ERP".
 *
 * WhatsApp reads the Open Graph tags from the head of the page and fetches the image itself, so the
 * image is a plain JPEG at the size the previews expect (1200 by 630, under 300 KB) with its size and
 * type spelled out, plus the older image_src link that some versions still read.
 */
export function customerPageMetadata(title: string, description: string, path?: string): Metadata {
  const url = `${PRODUCTION_SITE_URL}/preview.jpg`;
  const image = { url, secureUrl: url, width: 1200, height: 630, type: "image/jpeg", alt: "OFJ Automotive" };
  return {
    title,
    description,
    metadataBase: new URL(PRODUCTION_SITE_URL),
    openGraph: { title, description, siteName: "OFJ Automotive", images: [image], type: "website", locale: "en_AE", ...(path ? { url: `${PRODUCTION_SITE_URL}${path}` } : {}) },
    twitter: { card: "summary_large_image", title, description, images: [url] },
    robots: { index: false, follow: false },
    other: { image_src: url },
    icons: { other: [{ rel: "image_src", url }] },
  };
}
