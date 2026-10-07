import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_SESSION_HOURS, LOGIN_KIND_COOKIE, SESSION_UNTIL_COOKIE, sessionCookieOptions } from "@/lib/session";

/** Pages anyone may open without being logged in. */
const PUBLIC_PREFIXES = ["/login", "/auth", "/tablet", "/api/auth", "/api/tablet", "/api/media", "/api/approve", "/u", "/approve", "/terms"];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
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

  // The old vercel.app address always sends people to the company address.
  const host = request.headers.get("host") ?? "";
  if (host.endsWith(".vercel.app")) {
    const url = new URL(request.nextUrl.pathname + request.nextUrl.search, "https://erp.ofjauto.com");
    return NextResponse.redirect(url, 308);
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
