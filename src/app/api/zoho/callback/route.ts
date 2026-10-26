import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { ZOHO_STATE_COOKIE, connectWithCode } from "@/lib/zoho";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Back from Zoho's sign-in page: the check value must match, then the permission is stored (encrypted). */
export async function GET(request: NextRequest) {
  const origin = process.env.NODE_ENV === "production" ? PRODUCTION_SITE_URL : new URL(request.url).origin;
  const back = (kind: "message" | "error", text: string) => {
    const res = NextResponse.redirect(`${origin}/settings/zoho?${kind}=${encodeURIComponent(text)}`);
    res.cookies.set(ZOHO_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), maxAge: 0, path: "/api/zoho" });
    return res;
  };
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || staff.role_id !== "owner") return back("error", "Only the owner connects Zoho Books.");
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const expected = request.cookies.get(ZOHO_STATE_COOKIE)?.value ?? "";
  if (!state || !expected || state !== expected) return back("error", "The sign-in did not match this browser (it took over ten minutes, or came from another tab). Press Connect again.");
  if (url.searchParams.get("error")) return back("error", url.searchParams.get("error") === "access_denied" ? "The sign-in was cancelled on Zoho's page. Nothing was connected." : `Zoho said: ${url.searchParams.get("error")}.`);
  const code = url.searchParams.get("code");
  if (!code) return back("error", "Zoho sent no answer. Press Connect again.");
  const r = await connectWithCode(origin, code, staff.id);
  if ("error" in r) return back("error", r.error);
  return back("message", "Connected to Zoho Books. The organizations are listed below; pick OFJ TEST as the write target.");
}
