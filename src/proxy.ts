import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_SESSION_HOURS, LOGIN_KIND_COOKIE, SESSION_UNTIL_COOKIE, sessionCookieOptions } from "@/lib/session";
import { PASSKEY_SESSION_HOURS, passkeyPerson, rolloutOf, sessionNeedsCap } from "@/lib/passkey-rules";

/** A long sign-in ("Keep me signed in") was checked for the passkey 12-hour rule within the last hour. */
const CAP_CHECKED_COOKIE = "erp_cap_checked";

/**
 * Passkey users (7 November 2026) stay signed in 12 hours at most. A sign-in made before that rule (or before the
 * rollout reached the person) can end much later; this cuts it back. Asked at most once an hour per long sign-in.
 * Before the database change is applied the settings row is missing and nothing is cut.
 */
async function passkeyCapFor(userId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return false;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const [s, r] = await Promise.all([
      fetch(`${base}/rest/v1/settings?select=value&key=eq.passkeys_rollout`, { headers: h, cache: "no-store" }),
      fetch(`${base}/rest/v1/staff?select=role_id,team,department_id&id=eq.${userId}`, { headers: h, cache: "no-store" }),
    ]);
    if (!s.ok || !r.ok) return false;
    const setting = (await s.json()) as { value: unknown }[];
    const staff = (await r.json()) as { role_id: string; team: string | null; department_id: string | null }[];
    if (!setting.length || !staff.length) return false;
    return passkeyPerson(staff[0], rolloutOf(setting[0].value));
  } catch {
    return false;
  }
}

/** Pages anyone may open without being logged in. */
const PUBLIC_PREFIXES = ["/login", "/auth", "/tablet", "/api/auth", "/api/tablet", "/api/media", "/api/uploads", "/api/customer", "/api/approve", "/api/cron", "/u", "/approve", "/terms", "/report", "/quote", "/api/quote", "/api/pay", "/api/pdf", "/api/pdf-pages", "/invoice", "/proforma", "/lpo", "/q", "/api/e2e", "/fonts", "/s", "/handover", "/progress", "/drive", "/api/drive", "/m", "/d", "/i", "/r", "/k", "/p", "/warranty", "/statement"];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

async function deviceStillRegistered(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/devices?select=id&token_hash=eq.${hash}&is_active=eq.true`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) return true; // never lock everyone out because of a hiccup
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}

function redirectTo(request: NextRequest, pathname: string, search = "") {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  return NextResponse.redirect(url);
}

/**
 * Runs before every page. Keeps the login session fresh, ends sessions that
 * have passed their allowed time, and sends strangers to the login page.
 */
export async function proxy(request: NextRequest) {
  // Vercel's scheduler calls the jobs on the deployment's own vercel.app address and does not follow redirects, so
  // /api/cron/* is answered directly on any host, before the address redirect and the login check (from 7 to 23
  // October 2026 every scheduled run got the 308 below). Each cron route checks CRON_SECRET itself.
  if (request.nextUrl.pathname.startsWith("/api/cron/")) return NextResponse.next();

  // The page address for the server (a refusal writes down which page refused someone: src/lib/refusal.ts).
  request.headers.set("x-erp-path", request.nextUrl.pathname + request.nextUrl.search);
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // "View as" is view only: while the owner looks at the system as someone else, nothing can be changed.
  if (request.method !== "GET" && request.method !== "HEAD" && request.cookies.get("erp_view_as")?.value && !pathname.startsWith("/api/view-as") && !pathname.startsWith("/api/auth")) {
    return NextResponse.json({ error: "View only. You are looking at the system as someone else. Press Exit on the yellow bar to make changes." }, { status: 403 });
  }

  // The old vercel.app address always sends people to the company address.
  const host = request.headers.get("host") ?? "";
  if (host.endsWith(".vercel.app")) {
    const url = new URL(request.nextUrl.pathname + request.nextUrl.search, "https://erp.ofjauto.com");
    return NextResponse.redirect(url, 308);
  }

  if (user && request.cookies.get(LOGIN_KIND_COOKIE)?.value === "pin") {
    // A handheld session dies the moment its device is removed.
    const ok = await deviceStillRegistered(request.cookies.get("erp_device")?.value);
    if (!ok) {
      await supabase.auth.signOut();
      const out = redirectTo(request, "/tablet");
      response.cookies.getAll().forEach((c) => out.cookies.set(c.name, c.value, c));
      out.cookies.delete(SESSION_UNTIL_COOKIE);
      out.cookies.delete(LOGIN_KIND_COOKIE);
      return out;
    }
  }

  if (user) {
    const untilRaw = request.cookies.get(SESSION_UNTIL_COOKIE)?.value;
    const until = untilRaw ? Number(untilRaw) : NaN;
    if (!Number.isFinite(until)) {
      // A session without a limit yet: give it the default working-day window.
      const seconds = DEFAULT_SESSION_HOURS * 3600;
      response.cookies.set(SESSION_UNTIL_COOKIE, String(Date.now() + seconds * 1000), sessionCookieOptions(seconds));
    } else if (sessionNeedsCap(until, Date.now()) && !request.cookies.get(CAP_CHECKED_COOKIE)?.value) {
      if (await passkeyCapFor(user.id)) {
        const seconds = PASSKEY_SESSION_HOURS * 3600;
        response.cookies.set(SESSION_UNTIL_COOKIE, String(Date.now() + seconds * 1000), sessionCookieOptions(seconds));
      } else {
        response.cookies.set(CAP_CHECKED_COOKIE, "1", sessionCookieOptions(Math.min(3600, (until - Date.now()) / 1000)));
      }
    } else if (Date.now() > until) {
      await supabase.auth.signOut();
      const kind = request.cookies.get(LOGIN_KIND_COOKIE)?.value;
      const out =
        kind === "pin"
          ? redirectTo(request, "/tablet")
          : redirectTo(request, "/login", "?error=" + encodeURIComponent("Your session has ended. Please sign in again."));
      response.cookies.getAll().forEach((c) => out.cookies.set(c.name, c.value, c));
      out.cookies.delete(SESSION_UNTIL_COOKIE);
      out.cookies.delete(LOGIN_KIND_COOKIE);
      return out;
    }
  }

  if (!user && !isPublic(pathname)) {
    return redirectTo(request, "/login");
  }

  if (user && (pathname === "/login" || pathname === "/")) {
    return redirectTo(request, "/home");
  }

  if (!user && pathname === "/") {
    return redirectTo(request, "/login");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|version\\.json|api/cron/|fonts/|[mdqir]/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$).*)"],
};
