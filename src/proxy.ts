import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_SESSION_HOURS, LOGIN_KIND_COOKIE, SESSION_UNTIL_COOKIE, sessionCookieOptions } from "@/lib/session";

/** Pages anyone may open without being logged in. */
const PUBLIC_PREFIXES = ["/login", "/auth", "/tablet", "/api/auth", "/api/tablet", "/api/media", "/api/approve", "/api/cron", "/u", "/approve", "/terms", "/report"];

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
