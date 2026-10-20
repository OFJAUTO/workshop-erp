// One-off clean-up (21 October 2026, part 1 section 1.5): part numbers that imports had glued onto
// the NAME ("SCREW PLUG N000000 008789") are cut from part_items.description, open quotation lines
// and LPO lines; a number rescued from a name with an empty Part number column is moved there.
//   node --env-file=.env.local scripts/fix-part-names-21-oct.mjs          (dry run)
//   node --env-file=.env.local scripts/fix-part-names-21-oct.mjs --apply
import pg from "pg";

const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const client = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });

const compact = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function strip(name, partNumber) {
  if (!name) return { name, tail: null };
  let n = String(name).replace(/\s+/g, " ").trim();
  let tail = null;
  const cpn = compact(partNumber);
  if (cpn) {
    const tokens = n.split(" ");
    for (let take = Math.min(6, tokens.length - 1); take >= 1; take--) {
      if (tokens.slice(-take).some((t) => /^[([{]/.test(t))) continue; // a bracketed year or size is the name, never a glued-on number
      const c = compact(tokens.slice(-take).join(" "));
      if (c.length >= 5 && (c === cpn || cpn.endsWith(c))) {
        tail = tokens.slice(-take).join(" ");
        n = tokens.slice(0, -take).join(" ").trim();
        break;
      }
    }
  }
  const tokens = n.split(" ");
  let cut = tokens.length;
  while (cut > 1) {
    const t = tokens[cut - 1];
    if (/^[([{]/.test(t)) break; // a bracketed year or size is the name, never a glued-on number
    const digits = (t.match(/\d/g) ?? []).length;
    if (t.length >= 5 && digits >= 4 && digits >= Math.ceil(t.length * 0.6)) cut--;
    else break;
  }
  if (cut < tokens.length && tokens.slice(0, cut).join(" ").replace(/[^A-Za-z]/g, "").length >= 3) {
    tail = tail ?? tokens.slice(cut).join(" ");
    n = tokens.slice(0, cut).join(" ").trim();
  }
  return { name: n || String(name).trim(), tail };
}

await client.connect();
try {
  const report = { parts: 0, numbersRescued: 0, quoteLines: 0, poLines: 0 };
  const samples = [];

  const { rows: parts } = await client.query("select id, description, part_number from public.part_items where is_active and description is not null");
  for (const p of parts) {
    const r = strip(p.description, p.part_number);
    if (r.name !== String(p.description).replace(/\s+/g, " ").trim() && r.name !== p.description) {
      report.parts++;
      if (samples.length < 12) samples.push(`part: "${p.description}" -> "${r.name}"${!p.part_number && r.tail ? ` (number ${r.tail})` : ""}`);
      if (apply) {
        const patch = !p.part_number && r.tail ? [r.name, r.tail, p.id] : null;
        if (patch) {
          await client.query("update public.part_items set description = $1, part_number = $2 where id = $3", patch);
          report.numbersRescued++;
        } else await client.query("update public.part_items set description = $1 where id = $2", [r.name, p.id]);
      } else if (!p.part_number && r.tail) report.numbersRescued++;
    }
  }

  const { rows: qlines } = await client.query(`
    select l.id, l.title, p.part_number, p.customer_name, p.description
    from public.quotation_lines l
    join public.quotations q on q.id = l.quotation_id
    left join public.part_items p on p.id = l.part_item_id
    where l.is_active and l.part_item_id is not null and q.status in ('draft','pending_owner','sent','opened','urgent_requested')`);
  for (const l of qlines) {
    const want = (l.customer_name ?? "").trim() || strip(l.description ?? l.title, l.part_number).name;
    if (want && want !== l.title) {
      report.quoteLines++;
      if (samples.length < 12) samples.push(`quote line: "${l.title}" -> "${want}"`);
      if (apply) await client.query("update public.quotation_lines set title = $1 where id = $2", [want, l.id]);
    }
  }

  const { rows: polines } = await client.query("select id, description, part_number from public.purchase_order_lines where is_active and description is not null");
  for (const l of polines) {
    const r = strip(l.description, l.part_number);
    if (r.name !== String(l.description).replace(/\s+/g, " ").trim() && r.name !== l.description) {
      report.poLines++;
      if (samples.length < 12) samples.push(`LPO line: "${l.description}" -> "${r.name}"`);
      if (apply) await client.query("update public.purchase_order_lines set description = $1 where id = $2", [r.name, l.id]);
    }
  }

  console.log(`${apply ? "APPLIED" : "DRY RUN"}: parts ${report.parts} (numbers rescued ${report.numbersRescued}), quote lines ${report.quoteLines}, LPO lines ${report.poLines}`);
  for (const s of samples) console.log("  " + s);
} finally {
  await client.end();
}
