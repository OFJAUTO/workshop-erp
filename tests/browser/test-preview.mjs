// WhatsApp link previews (19 October 2026, section 2): every short link type answers HTTP 200 with the
// og tags and the square logo; a map pin stays a plain redirect; the image is public and under 100 KB.
//   node --env-file=.env.local tests/browser/test-preview.mjs
import { base, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const UA = "WhatsApp/2.23.20.0";

await sql(`insert into short_links (code, url, kind) values
  ('wbot1','https://erp.ofjauto.com/quote/testtoken1','page'),
  ('wbot2','https://erp.ofjauto.com/proforma/testtoken2','page'),
  ('wbot3','https://erp.ofjauto.com/api/pdf/receipt/testtoken3','page'),
  ('wbot4','https://erp.ofjauto.com/approve/testtoken4','page'),
  ('wbot5','https://erp.ofjauto.com/drive/testtoken5','drive'),
  ('wbot6','https://maps.app.goo.gl/abc123','map')
  on conflict do nothing`);

const CASES = [
  ["q/wbot1", "Your quotation"],
  ["i/wbot2", "Your invoice"],
  ["r/wbot3", "Your receipt"],
  ["m/wbot4", "Your job card"],
  ["d/wbot5", "Delivery"],
];
for (const [path, title] of CASES) {
  const r = await fetch(`${base}/${path}`, { headers: { "user-agent": UA }, redirect: "manual" });
  const html = await r.text();
  check(`/${path} answers 200`, r.status === 200, String(r.status));
  check(`/${path} og:title "${title}"`, html.includes(`og:title" content="OFJ Automotive – ${title}"`));
  check(`/${path} og:image is the square logo`, html.includes('og:image" content="https://erp.ofjauto.com/og/ofj-square.png"'));
  check(`/${path} redirects the human`, html.includes('http-equiv="refresh"') && html.includes("location.replace"));
  check(`/${path} no customer data`, !/testtoken\d<|Stage |AED /.test(html.replace(/url=[^"]+"/g, "").replace(/replace\([^)]+\)/g, "")));
}
{
  const r = await fetch(`${base}/m/wbot6`, { headers: { "user-agent": UA }, redirect: "manual" });
  check("a map pin stays a plain 302 to Google Maps", r.status === 302 && String(r.headers.get("location")).startsWith("https://maps.app.goo.gl/"), `${r.status} ${r.headers.get("location")}`);
}
{
  const r = await fetch(`${base}/og/ofj-square.png`);
  const bytes = (await r.arrayBuffer()).byteLength;
  check("the square logo is public, image/png, under 100 KB", r.status === 200 && String(r.headers.get("content-type")).includes("image/png") && bytes < 100 * 1024, `${r.status} ${bytes} bytes`);
}

await sql("delete from short_links where code like 'wbot%'");
process.exit(summary() ? 1 : 0);
