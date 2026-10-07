import "server-only";
import { headers } from "next/headers";

/** The public address of the live system. Generated links (setup, approval, phone upload) use it. */
export const PRODUCTION_SITE_URL = "https://erp.ofjauto.com";

/** The address this app is being opened at, for building links. On the live site this is always the company address. */
export async function getSiteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL) return PRODUCTION_SITE_URL;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}
