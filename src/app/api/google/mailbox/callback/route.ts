import { after, NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { STATE_COOKIE, connectWithCode } from "@/lib/google-mailbox";
import { checkScansMailbox } from "@/lib/mailbox";
import { PRODUCTION_SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Back from Google's sign-in page: the check value must match, the account must be scans@ofjauto.com, then the first read runs. */
export async function GET(request: NextRequest) {
  const origin = process.env.NODE_ENV === "production" ? PRODUCTION_SITE_URL : new URL(request.url).origin;
  const back = (kind: "message" | "error", text: string) => {
    const res = NextResponse.redirect(`${origin}/scans?${kind}=${encodeURIComponent(text)}`);
    res.cookies.set(STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), maxAge: 0, path: "/api/google/mailbox" });
    return res;
  };
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || staff.role_id !== "owner") return back("error", "Only the owner connects the scans mailbox.");
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const expected = request.cookies.get(STATE_COOKIE)?.value ?? "";
  if (!state || !expected || state !== expected) return back("error", "The sign-in did not match this browser (it took over ten minutes, or came from another tab). Press Connect again.");
  if (url.searchParams.get("error")) return back("error", url.searchParams.get("error") === "access_denied" ? "The sign-in was cancelled on Google's page. Nothing was connected." : `Google said: ${url.searchParams.get("error")}.`);
  const code = url.searchParams.get("code");
  if (!code) return back("error", "Google sent no answer. Press Connect again.");
  const r = await connectWithCode(origin, code, staff.id);
  if ("error" in r) return back("error", r.error);
  // The first read runs straight after the page comes back.
  after(async () => { await checkScansMailbox(); });
  return back("message", `Connected: ${r.mailbox}, read only. The first check runs now; refresh in a minute.`);
}
