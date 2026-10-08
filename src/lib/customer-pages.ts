import type { Metadata } from "next";
import { PRODUCTION_SITE_URL } from "./site";

/**
 * The standard for every page a customer opens from a WhatsApp link (approval, inspection report,
 * later quotations and estimates): the preview always shows the logo, a title and a one-line
 * description, never just the web address. Customers never see the words "Workshop ERP".
 */
export function customerPageMetadata(title: string, description: string): Metadata {
  const image = { url: `${PRODUCTION_SITE_URL}/logo.jpg`, width: 1206, height: 618 };
  return {
    title,
    description,
    metadataBase: new URL(PRODUCTION_SITE_URL),
    openGraph: { title, description, siteName: "OFJ Automotive", images: [image], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
    robots: { index: false, follow: false },
  };
}
