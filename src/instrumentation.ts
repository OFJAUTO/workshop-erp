/**
 * SPEED TRACE (11 November 2026, Section 16): only when the server is started with SPEED_TRACE=<file>, every call to
 * the database API is written to that file (start, duration, table) so the speed check can see which calls wait for
 * each other. Off everywhere else (the live site never sets it).
 */
export async function register() {
  const file = process.env.SPEED_TRACE;
  if (!file || process.env.NEXT_RUNTIME !== "nodejs") return;
  const { appendFileSync } = await import("node:fs");
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const orig = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!base || !url.startsWith(base)) return orig(input, init);
    const t0 = Date.now();
    try {
      return await orig(input, init);
    } finally {
      const u = new URL(url);
      appendFileSync(file, `${t0}\t${Date.now() - t0}\t${(init?.method ?? "GET").toUpperCase()}\t${u.pathname.replace("/rest/v1/", "")}\t${decodeURIComponent(u.search).slice(0, 160)}\n`);
    }
  };
}
