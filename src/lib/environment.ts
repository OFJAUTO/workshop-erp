/**
 * Live or test (30 October 2026, batch 2 section 1). Tests NEVER touch the live database: they run against the
 * separate TEST project through a test server started with `.env.test.local` (ERP_ENV=test). This file is the ONE
 * rule the server-side guards read (the /api/e2e routes, the Zoho door). The live project's reference is public (it is
 * in the address every browser loads), so it may be named here.
 */
export const LIVE_PROJECT_REF = "uhqcmqudszguqosnjadx";

/** The server is connected to the LIVE database. */
export function usesLiveDatabase(): boolean {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(LIVE_PROJECT_REF);
}

/** The server was started as the TEST server (`.env.test.local`) and is connected to a database that is not live. */
export function isTestEnvironment(): boolean {
  return process.env.ERP_ENV === "test" && !usesLiveDatabase();
}
