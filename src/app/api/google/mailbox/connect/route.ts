import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { STATE_COOKIE, consentUrl, oauthConfigured } from "@/lib/google-mailbox";
import { PRODUCTION_SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

/** The owner's "Connect scans@ofjauto.com": off to Google's own sign-in page, read only, with a one-time check value. */
export async function GET(request: NextRequest) {
  const origin = process.env.NODE_ENV === "production" ? PRODUCTION_SITE_URL : new URL(request.url).origin;
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || staff.role_id !== "owner") return NextResponse.redirect(`${origin}/scans?error=${encodeURIComponent("Only the owner connects the scans mailbox.")}`);
  if (!oauthConfigured()) return NextResponse.redirect(`${origin}/scans?error=${encodeURIComponent("Add GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and SCANS_MAILBOX in Vercel first (steps in the delivery note).")}`);
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(consentUrl(origin, state));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), maxAge: 600, path: "/api/google/mailbox" });
  return res;
}
