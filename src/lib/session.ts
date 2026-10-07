/** Cookies that bound how long a login lasts. Checked on every request by the proxy. */
export const SESSION_UNTIL_COOKIE = "erp_session_until";
export const LOGIN_KIND_COOKIE = "erp_login";

export const DEFAULT_SESSION_HOURS = 12;

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.max(60, Math.floor(maxAgeSeconds)),
  };
}

/** Returns the absolute expiry (ms since epoch) and cookie max-age for a login. */
export function sessionWindow(keepDays: number | null) {
  const seconds = keepDays && keepDays > 0 ? keepDays * 86400 : DEFAULT_SESSION_HOURS * 3600;
  return { untilMs: Date.now() + seconds * 1000, maxAgeSeconds: seconds };
}
