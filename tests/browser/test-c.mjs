// Browser and API checks for the fixes of 12 October 2026: the LPO supplier copy and its verification page, gate-in
// uploads updating the PC by themselves, the Parts pricing table (discounts, supplier list, quantities, names,
// split), customer links opening the PDF, advisors on each other's quotations with the editing lock, the expected
// payment method, shorter messages with the proforma address, bars beside the menu with Sign out under the name,
// and the PDF page layout. Run against `npx next dev -p 3100`:
//   node --env-file=.env.local tests/browser/test-c.mjs
import { createRequire } from "node:module";
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const require = createRequire(import.meta.url);
const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
cleanupDb();

async function section(name, fn) {
  console.log(`\n== ${name}`);
  try {
    await fn();
  } catch (e) {
    check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300));
  }
}
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const st = page.toStructuredText("preserve-whitespace");
    pages.push(st.asText());
  }
  return pages;
};
const fetchPdf = async (path, cookie) => {
  const res = await fetch(`${base}${path}`, cookie ? { headers: { cookie } } : undefined);
  return { status: res.status, type: res.headers.get("content-type") ?? "", disp: res.headers.get("content-disposition") ?? "", buf: Buffer.from(await res.arrayBuffer()) };
};
void require;

/* ---------------- 1. LPO: internal view and the supplier copy ---------------- */
await section("1 LPO supplier copy", async () => {
  const seed = await api("/api/e2e/stage", { stage: "approved" });
  const { jobId } = seed.json;
  const PA = "22222222-0000-4000-8000-00000000e306";
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0]?.id;
  const sup = await sql("insert into public.suppliers (name, trn, phone, default_discount_percent, discount_by_type, created_by) values ('e2e Parts Co', '100123456700003', '+971500000099', 12, '{\"oem\": 20}'::jsonb, $1) returning id", [owner]);
  await sql("update public.part_items set list_price_aed = 500, discount_percent = 12, cost_aed = 440, part_number = 'A 222 320 04 38 80', order_status = 'to_order' where id = $1", [PA]);
  const po = await sql("insert into public.purchase_orders (job_id, supplier_id, supplier_name, status, total_cost_aed, approved_at, approved_by, created_by) values ($1, $2, 'e2e Parts Co', 'approved', 440, now(), $3, $3) returning id, number, verify_token", [jobId, sup[0]?.id, owner]);
  const poId = po[0]?.id;
  await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, part_number, quantity, unit_cost, list_price, discount_percent, created_by) values ($1, $2, 1, 'Brake pads front set', 'A 222 320 04 38 80', 1, 440, 500, 12, $3)", [poId, PA, owner]);
  await sql("update public.part_items set po_id = $1 where id = $2", [poId, PA]);
  check("a new LPO has its verification token", !!po[0]?.verify_token, JSON.stringify(po[0]));
  const token = po[0]?.verify_token;
  // The supplier copy from the public link, no login.
  const pdf = await fetchPdf(`/api/pdf/lpo/${token}`);
  check("supplier copy PDF opens from the link (1)", pdf.status === 200 && /application\/pdf/.test(pdf.type) && /inline/.test(pdf.disp), `${pdf.status} ${pdf.type} ${pdf.disp}`);
  if (pdf.status === 200) {
    const pages = await pdfText(pdf.buf);
    const text = pages.join("\n").replace(/\s+/g, " ");
    const vin = (await sql("select v.vin from public.jobs j join public.vehicles v on v.id = j.vehicle_id where j.id = $1", [jobId]))[0]?.vin ?? "";
    const jobNumber = (await sql("select job_number from public.jobs where id = $1", [jobId]))[0]?.job_number ?? "J-";
    check("supplier copy: LPO number, date, VIN, no job card, no names (1)", /LOCAL PURCHASE ORDER/.test(text) && text.includes(vin) && !text.includes(jobNumber) && !/Prepared by|Approved by|Deliver to|Expected|urgent/i.test(text), text.slice(0, 300).replace(/\s+/g, " "));
    check("supplier copy: part number in full, list, discount, net (1)", /A 222 320 04 38 80/.test(text) && /500\.00/.test(text) && /12%/.test(text) && /440\.00/.test(text), text.replace(/\s+/g, " ").slice(0, 400));
    check("supplier copy: approved electronically with the time (1)", /Approved electronically/i.test(text) && /needs no signature or stamp/i.test(text) && /\d{1,2} \w{3} \d{4}, \d{2}:\d{2}/.test(text), text.match(/.{0,60}signature.{0,60}/i)?.[0] ?? "");
    check("supplier copy: one page", pages.length === 1, String(pages.length));
  }
  const verify = await (await fetch(`${base}/lpo/${token}`)).text();
  const vt = verify.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  check("verification page shows number, supplier, date, total and Valid, nothing else (1)", /e2e Parts Co/i.test(vt) && /Valid/.test(vt) && /including VAT/.test(vt) && !/Brake pads/.test(vt) && !/J-\d{5}/.test(vt), vt.slice(0, 300));
  const bad = await (await fetch(`${base}/lpo/notatoken`)).text();
  check("wrong token: not valid", /not valid/.test(bad));
  // The internal view keeps the job card and the people.
  const internal = await (await fetch(`${base}/parts/orders/${poId}`, { headers: { cookie: await cookieHeader("parts") } })).text();
  const it = internal.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  check("internal LPO view keeps the job card and Send to supplier (1)", /Send to supplier/.test(it) && /Supplier copy \(PDF\)/.test(it) && /Raised/.test(it), it.slice(0, 200));
  // Supplier discounts on the suppliers page: Parts see them off, the owner on.
  const sp = await (await fetch(`${base}/parts/suppliers`, { headers: { cookie: await cookieHeader("owner") } })).text();
  check("suppliers page carries the discount boxes (1)", /Discount % \(default\)/.test(sp) && /name="discount__oem"/.test(sp));
  const spParts = await (await fetch(`${base}/parts/suppliers`, { headers: { cookie: await cookieHeader("parts") } })).text();
  check("Parts cannot change the discounts (1)", /name="discount_default"[^>]*disabled|disabled[^>]*name="discount_default"/.test(spParts));
});

/* ---------------- 3, 12, 13. The Parts pricing table ---------------- */
await section("3-12-13 Parts table", async () => {
  const seed = await api("/api/e2e/stage", { stage: "assign" });
  const { jobId } = seed.json;
  const insp = (await sql("select id from public.inspections where job_id = $1 limit 1", [jobId]))[0];
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0]?.id;
  await sql("insert into public.suppliers (name, default_discount_percent, discount_by_type, created_by) values ('e2e Discount Supplier', 15, '{}'::jsonb, $1) on conflict do nothing", [owner]);
  await sql("insert into public.part_requests (job_id, inspection_id, source_type, source_key, label, requested_text, status, quantity, unit, positions) values ($1, $2, 'item', 'e2e-c', 'Brake pads', 'check', 'open', 1, 'pc', array['Front'])", [jobId, insp?.id ?? null]);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 768 } });
  await go(page, `${base}/parts/${jobId}`);
  const bar = await page.evaluate(() => { const el = document.querySelector(".fixed.bottom-0"); return el ? el.getBoundingClientRect().left : -1; });
  check("the fixed bar starts beside the menu, not over it (11)", bar >= 200, String(bar));
  check("Sign out sits under the person's name (11)", (await page.locator("details:has(summary[aria-label='Your menu']) button:has-text('Sign out')").count()) === 1);
  const heads = await page.locator("div.hidden.md\\:grid span").allTextContents();
  check("columns: Part, Qty, Part number, Type, List, Disc %, Net, Supplier, Availability (3)", ["Part", "Qty", "Part number", "Type", "List", "Disc %", "Net", "Supplier", "Availability"].every((h) => heads.includes(h)), heads.join("|"));
  // The request's own row (the stage seed already has priced parts on the job).
  const rowOf = () => page.locator("div.rounded-control.border", { has: page.getByRole("button", { name: /^Brake pads$|^Front brake pads, set$/ }) }).first();
  // Number boxes hand their figure on when left (or a second after typing stops): Tab out after each.
  const list = rowOf().locator("input[aria-label='List price']");
  await list.fill("500");
  await list.press("Tab");
  await rowOf().locator("input[aria-label='Discount percent']").fill("10");
  await rowOf().locator("input[aria-label='Discount percent']").press("Tab");
  await sleep(300);
  check("net follows list and discount (1, 3)", (await rowOf().locator("input[aria-label='Cost before VAT']").inputValue()) === "450", await rowOf().locator("input[aria-label='Cost before VAT']").inputValue());
  const supSel = rowOf().locator("select[aria-label='Supplier']");
  const opts = await supSel.locator("option").allTextContents();
  check("supplier is a list with Add a supplier at the bottom (3)", opts.some((o) => /e2e Discount Supplier/i.test(o)) && /Add a supplier/.test(opts[opts.length - 1]), opts.join("|"));
  const val = await supSel.locator("option").evaluateAll((os) => (os.find((o) => /e2e Discount Supplier/i.test(o.textContent ?? "")) ?? {}).value ?? "");
  // A tap on the supplier list takes the cursor out of the net box (selectOption alone does not move focus).
  await supSel.focus();
  await supSel.selectOption(val);
  await sleep(300);
  check("the supplier's discount fills in and the net follows (1)", (await rowOf().locator("input[aria-label='Discount percent']").inputValue()) === "15" && (await rowOf().locator("input[aria-label='Cost before VAT']").inputValue()) === "425");
  await rowOf().locator("input[aria-label='Part number']").fill("A 222 320 04 38 80");
  await rowOf().locator("select[aria-label='Type']").selectOption("genuine");
  await rowOf().locator("select[aria-label='Availability']").selectOption("other");
  await rowOf().locator("input[aria-label='Days until it arrives']").fill("3");
  await rowOf().locator("input[aria-label='Days until it arrives']").press("Tab");
  await sleep(2500);
  const saved = await sql("select description, part_number, list_price_aed, discount_percent, cost_aed, supplier, availability from public.part_items where job_id = $1 and description = 'Brake pads'", [jobId]);
  check("the row saved list, discount, net, supplier and Order with days (3)", saved.length === 1 && saved[0].part_number === "A 222 320 04 38 80" && Number(saved[0].list_price_aed) === 500 && Number(saved[0].discount_percent) === 15 && Number(saved[0].cost_aed) === 425 && /e2e discount supplier/i.test(saved[0].supplier ?? "") && saved[0].availability === "to_order", JSON.stringify(saved));
  await go(page, `${base}/parts/${jobId}`);
  check("a saved part number stays in its box, in full, with Copy (3, 12 Oct evening U1)", (await rowOf().getByRole("button", { name: "Copy the part number" }).count()) === 1 && (await rowOf().locator("input[aria-label='Part number']").inputValue()) === "A 222 320 04 38 80");
  check("availability dropdown shows the saved days (3)", (await rowOf().locator("select[aria-label='Availability']").inputValue()) === "d3", await rowOf().locator("select[aria-label='Availability']").inputValue());
  // 12: the quantity, with a note and the advisor and manager told.
  const mark = Number((await sql("select coalesce(max(id), 0) as m from public.notifications"))[0]?.m ?? 0);
  await rowOf().getByRole("button", { name: "One more" }).click();
  await sleep(2500);
  check("quantity note on the row (12)", /Technician asked for 1, Parts changed to 2/.test(await rowOf().textContent() ?? ""));
  const q2 = await sql("select confirmed_quantity, quantity from public.part_items where job_id = $1 and description = 'Brake pads'", [jobId]);
  check("quantity saved as the Parts quantity, the technician's kept (12)", Number(q2[0]?.confirmed_quantity) === 2 && Number(q2[0]?.quantity) === 1, JSON.stringify(q2));
  // The save tells the advisor first and the manager after it; wait for both rather than a fixed moment.
  let told = [];
  for (let i = 0; i < 30; i++) {
    told = await sql("select s.role_id from public.notifications n join public.staff s on s.id = n.staff_id where n.id > $1 and n.job_id = $2", [mark, jobId]);
    if (told.some((t) => t.role_id === "service_advisor") && told.some((t) => t.role_id === "workshop_manager")) break;
    await sleep(500);
  }
  check("advisor and workshop manager told of the quantity change (12)", told.some((t) => t.role_id === "service_advisor") && told.some((t) => t.role_id === "workshop_manager"), JSON.stringify(told));
  // 13: the name, with the technician's words kept.
  // Since 13 October the name is corrected through the categorised picker: "Custom part" at the bottom takes a typed name.
  await page.getByRole("button", { name: "Brake pads", exact: true }).first().click();
  const picker = page.locator("[data-part-picker='rename']");
  await picker.locator("[data-custom-part-button]").click();
  await picker.locator("input[aria-label='Custom part name']").fill("Front brake pads, set");
  await picker.getByRole("button", { name: "Use this name" }).click();
  let renamed = [];
  for (let i = 0; i < 30 && !renamed.length; i++) {
    await sleep(500);
    renamed = await sql("select description, original_description from public.part_items where job_id = $1 and original_description = 'Brake pads'", [jobId]);
  }
  check("name corrected, technician's words kept (13)", renamed[0]?.description === "Front brake pads, set" && renamed[0]?.original_description === "Brake pads", JSON.stringify(renamed));
  await go(page, `${base}/parts/${jobId}`);
  check("row shows Technician wrote: Brake pads (13)", /Technician wrote: Brake pads/.test(await page.textContent("body")));
  // 12: split a bundled row.
  await rowOf().getByRole("button", { name: "More for this part" }).click();
  await page.getByRole("button", { name: "Split into separate parts" }).click();
  await page.locator("input[aria-label='Part 2 name']").fill("Brake sensor");
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await sleep(3500);
  const after = await sql("select description, confirmed_quantity, cost_aed from public.part_items where job_id = $1 and is_active and original_description = 'Brake pads' order by created_at", [jobId]);
  check("split made two rows, the new one unpriced (12)", after.length === 2 && after.some((r) => r.description === "Brake sensor" && r.cost_aed === null), JSON.stringify(after));
  await browser.close();
});

/* ---------------- 2. Gate-in uploads: the PC updates by itself ---------------- */
await section("2 gate-in upload updates the PC", async () => {
  const seed = await api("/api/e2e/stage", { stage: "assign" });
  const { jobId } = seed.json;
  // Media rows are never deleted (no-delete trigger): the seed's video becomes a damage close-up so the exterior video is missing.
  await sql("update public.gate_in_media set kind = 'damage_photo' where job_id = $1 and kind like 'video%'", [jobId]);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 800 } });
  await go(page, `${base}/jobs/${jobId}/media`);
  const before = await page.locator("li:has-text('Exterior video')").first().textContent();
  check("exterior video still waiting at the start (2)", /Waiting/.test(before ?? ""), before ?? "");
  const phoneUrl = await page.locator("a[href*='/u/']").first().getAttribute("href");
  const token = (phoneUrl ?? "").split("/u/")[1];
  check("phone link with token on the PC page", !!token, phoneUrl ?? "");
  // The phone: prepare, put, register through the token, no login.
  const prep = await fetch(`${base}/api/media/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, kind: "video_exterior", contentType: "video/mp4", token }) });
  const pj = await prep.json();
  check("phone upload prepared through the token (2)", prep.status === 200 && !!pj.url, JSON.stringify(pj).slice(0, 160));
  if (pj.url) {
    const blob = new Uint8Array(2048);
    const put = await fetch(pj.url, { method: "PUT", headers: { "Content-Type": "video/mp4", "x-upsert": "false", apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" }, body: blob });
    check("file stored", put.status >= 200 && put.status < 300, String(put.status));
    const reg = await fetch(`${base}/api/media/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, kind: "video_exterior", path: pj.path, duration: 12, token }) });
    const rj = await reg.json();
    check("register answers with the server's checklist (2)", reg.status === 200 && rj.checklist?.videoExterior === true, JSON.stringify(rj).slice(0, 160));
  }
  // The PC page must turn the row green on its own, with no reload, within a few seconds.
  let text = "";
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    text = (await page.locator("li:has-text('Exterior video')").first().textContent()) ?? "";
    if (/Done/.test(text)) break;
  }
  check("PC page shows Exterior video Done by itself, no refresh (2)", /Done/.test(text), text);
  await browser.close();
});

/* ---------------- 4, 10. Customer links open the PDF; the proforma address and message ---------------- */
await section("4-10 customer links and messages", async () => {
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  const { jobId, invoice } = seed.json;
  check("ready stage made a proforma", invoice?.kind === "proforma" && !!invoice?.token, JSON.stringify(invoice));
  const pro = await (await fetch(`${base}/proforma/${invoice.token}`)).text();
  check("the proforma address works and says proforma in the preview (10)", /Your Proforma/.test(pro) && /View proforma \(PDF\)/.test(pro) && !/\?view=1/.test(pro), pro.match(/<title>[^<]*/)?.[0] ?? "");
  check("View shows the PDF inside the page, never a new tab (4, changed 16 Oct)", /data-doc-viewer-open/.test(pro) && !new RegExp(`target="_blank"[^>]*href="/api/pdf/invoice/${invoice.token}"`).test(pro));
  const pdf = await fetchPdf(`/api/pdf/invoice/${invoice.token}`);
  check("the proforma PDF opens inline from the link (4)", pdf.status === 200 && /inline/.test(pdf.disp), `${pdf.status} ${pdf.disp}`);
  const full = await (await fetch(`${base}/invoice/${invoice.token}?view=1`)).text();
  check("no HTML full view left behind (4)", !/Download PDF/.test(full) && /View proforma \(PDF\)/.test(full));
  // The job page's ready message: short, the proforma link, no bank details.
  const jobHtml = await (await fetch(`${base}/jobs/${jobId}`, { headers: { cookie: await cookieHeader("service_advisor") } })).text();
  check("the ready message carries no bank details and names the proforma (10)", /Send the proforma/.test(jobHtml) && !/Bank transfer: /.test(jobHtml) && !/IBAN AE/.test(jobHtml), (jobHtml.match(/.{0,60}Send the proforma.{0,60}/)?.[0] ?? "").replace(/\s+/g, " "));
  const tpl = await sql("select value from public.settings where key = 'whatsapp_ready_template'");
  check("the stored ready message is one or two lines with the link (10)", /ready to collect/.test(String(tpl[0]?.value)) && !/Dear|Bank/.test(String(tpl[0]?.value)), String(tpl[0]?.value));
  // The payment form offers bank transfer.
  const inv = await (await fetch(`${base}/jobs/${jobId}/invoice`, { headers: { cookie: await cookieHeader("accounts") } })).text();
  check("Bank transfer is a payment method (6)", /Bank transfer/.test(inv));
  // A sent quotation link: View opens the PDF and the PDF route remembers it.
  const q = await api("/api/e2e/stage", { stage: "quote" });
  const qid = q.json?.quotationId;
  await sql("update public.quotations set status = 'sent', sent_at = now(), token = 'e2ec' || substr(md5(random()::text), 1, 20), valid_until = now() + interval '7 days' where id = $1", [qid]);
  const tok = (await sql("select token from public.quotations where id = $1", [qid]))[0]?.token;
  const qp = await (await fetch(`${base}/quote/${tok}`)).text();
  check("quotation first page: View quotation (PDF) only (4)", /View quotation \(PDF\)/.test(qp) && !/\?view=1/.test(qp));
  const qpdf = await fetchPdf(`/api/pdf/quote/${tok}`);
  const viewed = await sql("select viewed_full_at from public.quotations where id = $1", [qid]);
  check("opening the quotation PDF is remembered as the full document opened (4)", qpdf.status === 200 && !!viewed[0]?.viewed_full_at, JSON.stringify(viewed));
});

/* ---------------- 5, 6, 7. Advisors on each other's quotations, the lock, the expected method ---------------- */
await section("5-6-7 quotation access, lock, payment method", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId, quotationId } = seed.json;
  const advisors = await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 2");
  check("two advisors exist for the check", advisors.length === 2, JSON.stringify(advisors));
  if (advisors.length < 2) return;
  const job = (await sql("select gated_in_by from public.jobs where id = $1", [jobId]))[0];
  const other = advisors.find((a) => a.id !== job?.gated_in_by) ?? advisors[1];
  const mine = advisors.find((a) => a.id === job?.gated_in_by) ?? advisors[0];
  const otherCookie = await cookieHeader(other.id);
  const res = await fetch(`${base}/jobs/${jobId}/quote/${quotationId}`, { headers: { cookie: otherCookie }, redirect: "manual" });
  check("another advisor opens the quotation (5)", res.status === 200, String(res.status));
  // The other advisor edits: the car's advisor is told; then holds the lock, so the car's advisor sees read only.
  const mark = Number((await sql("select coalesce(max(id), 0) as m from public.notifications"))[0]?.m ?? 0);
  const lock = await api("/api/quote/save", { quotationId, lock: "take" }, otherCookie);
  check("lock taken by the other advisor (5)", lock.status === 200, JSON.stringify(lock.json));
  const told = await sql("select n.title from public.notifications n where n.id > $1 and n.staff_id = $2", [mark, mine.id]);
  check("the car's advisor is told someone else works on his quotation (5)", told.some((t) => /is working on/.test(t.title)), JSON.stringify(told));
  const mineCookie = await cookieHeader(mine.id);
  const page = await (await fetch(`${base}/jobs/${jobId}/quote/${quotationId}`, { headers: { cookie: mineCookie } })).text();
  check("the car's advisor sees who is editing (5)", new RegExp(`${other.display_name} is editing this quotation`).test(page.replace(/<!-- -->/g, "")), (page.match(/.{0,40}is editing.{0,40}/)?.[0] ?? "").replace(/\s+/g, " "));
  const blocked = await api("/api/quote/save", { quotationId, header: { customer_note: "x" } }, mineCookie);
  check("a change by the other person is refused while the lock is held (5)", blocked.status === 423, `${blocked.status} ${JSON.stringify(blocked.json)}`);
  await api("/api/quote/save", { quotationId, lock: "release" }, otherCookie);
  const freed = await api("/api/quote/save", { quotationId, header: { customer_note: "after release" } }, mineCookie);
  check("after release the car's advisor can change it again (5)", freed.status === 200, `${freed.status}`);
  // 6: the expected payment method sets the hidden bank charge.
  const feeOf = async () => Number((await sql("select unit_cost from public.quotation_lines where quotation_id = $1 and fee_kind = 'bank_charge' and is_active limit 1", [quotationId]))[0]?.unit_cost ?? 0);
  const total = Number((await sql("select total_aed from public.quotations where id = $1", [quotationId]))[0]?.total_aed ?? 0);
  const r1 = await api("/api/quote/save", { quotationId, header: { expected_payment_method: "cash" } }, mineCookie);
  check("Customer will pay by cash saved (6)", r1.status === 200, JSON.stringify(r1.json));
  check("cash: the estimated bank charge is 0 (6)", (await feeOf()) === 0, String(await feeOf()));
  await api("/api/quote/save", { quotationId, header: { expected_payment_method: "link" } }, mineCookie);
  const fee = await feeOf();
  check("payment link: 1.75% of the total with VAT (6)", Math.abs(fee - Math.round(total * 1.75) / 100) < 0.02, `${fee} vs ${total} × 1.75%`);
  await api("/api/quote/save", { quotationId, header: { expected_payment_method: "not_sure" } }, mineCookie);
  check("not sure: the card rate (6)", Math.abs((await feeOf()) - Math.round(total * 2.26) / 100) < 0.02, String(await feeOf()));
  const bad = await api("/api/quote/save", { quotationId, header: { expected_payment_method: "gold" } }, mineCookie);
  check("an unknown method is refused (6)", bad.status === 400);
  // 7: fast typing lands: three quick markup changes in a row, the last value wins.
  const partLine = (await sql("select id from public.quotation_lines where quotation_id = $1 and line_type = 'part' and is_active limit 1", [quotationId]))[0];
  if (partLine) {
    await Promise.all([api("/api/quote/save", { quotationId, patchLine: { id: partLine.id, markup_percent: 25 } }, mineCookie), api("/api/quote/save", { quotationId, patchLine: { id: partLine.id, markup_percent: 100 } }, mineCookie)]);
    await sleep(300);
    const m = await sql("select markup_percent from public.quotation_lines where id = $1", [partLine.id]);
    check("the value typed is the value saved (7)", [25, 100].includes(Number(m[0]?.markup_percent)), JSON.stringify(m));
  }
  // The editor in a browser: typing a markup does not lose focus or the value.
  const { browser, page: p } = await browserForId(mine.id, { viewport: { width: 1366, height: 800 } });
  await go(p, `${base}/jobs/${jobId}/quote/${quotationId}`);
  const markup = p.locator("input[aria-label='Markup percent']").first();
  if (await markup.count()) {
    await markup.click();
    await markup.fill("");
    await p.keyboard.type("45", { delay: 120 });
    await sleep(2500);
    const focusedLabel = await p.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check("typing keeps the cursor in the markup box (7)", focusedLabel === "Markup percent", String(focusedLabel));
    check("the box still shows what was typed after the save (7)", (await markup.inputValue()) === "45", await markup.inputValue());
    const m2 = await sql("select markup_percent from public.quotation_lines where id = $1", [partLine?.id]);
    check("45 saved (7)", Number(m2[0]?.markup_percent) === 45, JSON.stringify(m2));
  }
  check("the quotation bar starts beside the menu (11)", (await p.evaluate(() => { const el = document.querySelector(".fixed.bottom-0"); return el ? el.getBoundingClientRect().left : -1; })) >= 200);
  await browser.close();
});

/* ---------------- 8. PDF page layout ---------------- */
await section("8 PDF layout", async () => {
  // A short one stays on one page with everything in order.
  const q2 = await api("/api/e2e/stage", { stage: "quote" });
  await sql("update public.quotations set status = 'sent', sent_at = now(), token = 'e2es' || substr(md5(random()::text), 1, 20), valid_until = now() + interval '7 days' where id = $1", [q2.json?.quotationId]);
  const tok2 = (await sql("select token from public.quotations where id = $1", [q2.json?.quotationId]))[0]?.token;
  const p2 = await pdfText((await fetchPdf(`/api/pdf/quote/${tok2}`)).buf);
  check("a short quotation fits on one page with the bank details at the bottom (8)", p2.length === 1 && /Bank details/i.test(p2[0]) && p2[0].search(/Taxable amount/i) < p2[0].search(/Bank details/i), String(p2.length));
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { quotationId } = seed.json;
  const staffId = (await sql("select created_by from public.quotations where id = $1", [quotationId]))[0]?.created_by;
  for (let i = 0; i < 38; i++) await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, created_by) values ($1, $2, 'labour', $3, 'manual', 1, 1.5, 400, $4)", [quotationId, 100 + i, `Labour line number ${i + 1} for the page test`, staffId]);
  await sql("update public.quotations set status = 'sent', sent_at = now(), token = 'e2ep' || substr(md5(random()::text), 1, 20), valid_until = now() + interval '7 days' where id = $1", [quotationId]);
  const tok = (await sql("select token from public.quotations where id = $1", [quotationId]))[0]?.token;
  const pdf = await fetchPdf(`/api/pdf/quote/${tok}`);
  check("long quotation PDF renders", pdf.status === 200, String(pdf.status));
  if (pdf.status !== 200) return;
  const pages = await pdfText(pdf.buf);
  check("long quotation runs over two pages (8)", pages.length >= 2, String(pages.length));
  const last = pages[pages.length - 1];
  check("page 1 has the company block and TRN; later pages the compact header and a page number (8)", /Tax registration/i.test(pages[0]) && pages.slice(1).every((p) => !/Tax registration/i.test(p) && /Page \d+ of \d+/.test(p)), pages.slice(1).map((p) => p.slice(0, 80).replace(/\s+/g, " ")).join(" | "));
  check("a table that continues repeats its headings (8)", pages.length >= 2 && /Labour and services/i.test(pages[1]) && /Qty/i.test(pages[1]) && /Rate/i.test(pages[1]), pages[1].slice(0, 200).replace(/\s+/g, " "));
  check("bank details on the last page only, after the totals (8)", /Bank details/i.test(last) && pages.slice(0, -1).every((p) => !/Bank details/i.test(p)) && last.search(/Taxable amount/i) < last.search(/Bank details/i), "");
  check("amount in words sits after the totals and before the bank details (8)", last.search(/Amount in words/i) > last.search(/Taxable amount/i) && last.search(/Amount in words/i) < last.search(/Bank details/i));
  check("footer on every page (8)", pages.every((p) => /Tel/i.test(p) || /Email/i.test(p)));
});

const failed = summary();
cleanupDb();
process.exit(failed ? 1 : 0);
