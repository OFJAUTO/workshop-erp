import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { ZOHO_STATE_COOKIE, consentUrl, zohoConfigured } from "@/lib/zoho";

export const dynamic = "force-dynamic";

/** The owner's "Connect Zoho Books": off to Zoho's own sign-in page with a one-time check value. */
export async function GET(request: NextRequest) {
  const origin = process.env.NODE_ENV === "production" ? PRODUCTION_SITE_URL : new URL(request.url).origin;
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || staff.role_id !== "owner") return NextResponse.redirect(`${origin}/settings/zoho?error=${encodeURIComponent("Only the owner connects Zoho Books.")}`);
  if (!zohoConfigured()) return NextResponse.redirect(`${origin}/settings/zoho?error=${encodeURIComponent("Add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in Vercel first (steps in the delivery note).")}`);
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(consentUrl(origin, state));
  res.cookies.set(ZOHO_STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), maxAge: 600, path: "/api/zoho" });
  return res;
}
