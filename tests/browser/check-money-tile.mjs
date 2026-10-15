// Quick check after the payment-flow migration: the job card and the invoice page open for cars at Ready
// (one real car with a tax invoice, one seeded car with a proforma) and the money tile is there.
import { api, base, cleanupDb, cookieHeader } from "./pw-lib.mjs";

async function fetchAs(pathname, role) {
  const res = await fetch(`${base}${pathname}`, { headers: { cookie: await cookieHeader(role) }, redirect: "manual" });
  const text = await res.text();
  return { status: res.status, text };
}
const real = process.argv[2];
let ok = true;
const report = (label, pass, extra = "") => { console.log(`${pass ? "PASS" : "FAIL"} ${label}${extra ? " · " + extra : ""}`); if (!pass) ok = false; };

if (real) {
  const r = await fetchAs(`/jobs/${real}`, "owner");
  report("real Ready car: job card opens", r.status === 200, String(r.status));
  report("real Ready car: money tile present", /data-money-tile/.test(r.text), (r.text.match(/data-money-step="([a-z_]+)"/) ?? [])[1] ?? "no step");
  const inv = await fetchAs(`/jobs/${real}/invoice`, "owner");
  report("real Ready car: invoice page opens", inv.status === 200, String(inv.status));
}
const seed = await api("/api/e2e/stage", { stage: "ready" });
const jobId = seed.json?.jobId;
report("seed ready car", !!jobId, JSON.stringify(seed.json?.invoice ?? null));
if (jobId) {
  for (const role of ["owner", "service_advisor", "accounts"]) {
    const r = await fetchAs(`/jobs/${jobId}`, role);
    report(`seeded car: job card opens as ${role}`, r.status === 200, String(r.status));
    if (role === "owner") report("seeded car: tile says proforma to send", /data-money-step="proforma_sent"/.test(r.text) && /Send the proforma/.test(r.text));
    const inv = await fetchAs(`/jobs/${jobId}/invoice`, role);
    report(`seeded car: invoice page opens as ${role}`, inv.status === 200, String(inv.status));
  }
  const dash = await fetchAs(`/dashboard`, "owner");
  const dashText = dash.text.replace(/<!--.*?-->/g, "");
  report("owner dashboard opens with the profit panel", dash.status === 200 && /data-profit-panel/.test(dashText) && /of AED/.test(dashText));
  const acc = await fetchAs(`/dashboard`, "accounts");
  report("accounts dashboard opens", acc.status === 200);
}
cleanupDb();
process.exit(ok ? 0 : 1);
