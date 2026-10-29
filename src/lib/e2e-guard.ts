/**
 * THE rule for the local test routes (/api/e2e/*): they answer only on a developer's machine - never on any Vercel
 * deployment, never in a production build unless it is the local test server (E2E_LOCAL_SERVER=1, set only by
 * scripts/test-server.mjs) - and only with the right x-e2e-secret header (E2E_SECRET is never set on Vercel).
 */
export function e2eRefused(request: Request): boolean {
  if (process.env.VERCEL) return true;
  if (process.env.NODE_ENV === "production" && process.env.E2E_LOCAL_SERVER !== "1") return true;
  const secret = process.env.E2E_SECRET;
  return !secret || request.headers.get("x-e2e-secret") !== secret;
}
