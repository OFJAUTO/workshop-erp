// 13 November 2026 (Section 2): the dead-link check. For every role: open every menu item, then every link and link-button
// on those pages (one level deep, each address shape once), and list anything that answers 404 or 500. TEST only.
//   node --env-file=.env.test.local tests/browser/dead-links.mjs            (ROLES=parts,gate_in to limit)
import { api, base, cleanupDb, cookieHeader } from "./pw-lib.mjs";

const ROLES = (process.env.ROLES ?? "owner,service_advisor,accounts,parts,workshop_manager,technician,gate_in,qc_inspector,team_leader").split(",");
const shape = (u) => u.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").replace(/\?.*$/, "");
const skip = (u) => !u.startsWith("/") || u.startsWith("//") || /^\/(api\/(?!pdf)|_next|auth|logout|tablet\/register)/.test(u) || /\.(pdf|png|jpg|svg|xlsx|csv)$/.test(u) || u.startsWith("/api/export");
const linksOf = (html) => Array.from(html.matchAll(/href="([^"#]+)/g)).map((m) => m[1].replace(/&amp;/g, "&"));

cleanupDb();
await api("/api/e2e/stage", { stage: "ready" });
const bad = [];
let opened = 0;
for (const role of ROLES) {
  let cookie;
  try { cookie = await cookieHeader(role); } catch { console.log(`(no ${role} on TEST)`); continue; }
  const get = async (u) => {
    const r = await fetch(`${base}${u}`, { headers: { cookie }, redirect: "manual" });
    return { status: r.status, html: r.status === 200 ? await r.text() : "", location: r.headers.get("location") };
  };
  // Each role's own first page (technicians start on My jobs): follow the move.
  const homeRes = await fetch(`${base}/dashboard`, { headers: { cookie }, redirect: "follow" });
  const home = { html: homeRes.status === 200 ? await homeRes.text() : "" };
  const menu = Array.from(new Set(linksOf(home.html).filter((u) => !skip(u))));
  const seen = new Set();
  const queue = menu.map((u) => ({ u, from: "menu" }));
  for (let i = 0; i < queue.length; i++) {
    const { u, from } = queue[i];
    const key = shape(u);
    if (seen.has(key)) continue;
    seen.add(key);
    const r = await get(u);
    opened++;
    if (r.status === 404 || r.status >= 500) bad.push({ role, url: u, status: r.status, from });
    // One level deeper from the menu pages only.
    if (from === "menu" && r.status === 200) for (const v of linksOf(r.html)) if (!skip(v) && !seen.has(shape(v))) queue.push({ u: v, from: u });
  }
  console.log(`${role}: ${seen.size} addresses opened`);
}
console.log(`\n${opened} pages opened.`);
if (bad.length) {
  console.log(`DEAD LINKS (${bad.length}):`);
  for (const b of bad) console.log(`FAIL ${b.role} · ${b.status} · ${b.url} (from ${b.from})`);
} else console.log("No dead links: nothing answered 404 or 500.");
cleanupDb();
process.exit(bad.length ? 1 : 0);
