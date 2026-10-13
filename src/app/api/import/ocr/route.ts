import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { readTable } from "@/lib/price-import";
import { can, type RoleId } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_OCR_MODEL || "claude-sonnet-5-5";
const MEDIA = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const PROMPT = `This is a screenshot of a car parts supplier's price list or quotation. Read the table exactly as printed.
Reply with JSON only, no words around it, in this shape:
{"headings": ["...", "..."], "rows": [["cell", "cell", ...], ...], "totals": [{"label": "Gross Amount", "value": "11,853.00"}]}
Rules: one entry per column heading, in order; one row per part line with one cell per heading, every cell the exact text you see (keep commas and spaces in numbers and part numbers); a cell you cannot read with confidence is "" (empty), never a guess; "totals" lists any labelled totals under the table (gross, VAT, net, total) with their text; no other keys.`;

/**
 * Reads a supplier's table out of a screenshot with the Anthropic API (vision). Off until ANTHROPIC_API_KEY exists
 * in the environment; the key is never sent to the browser. The answer goes through the same reader as a file, and
 * Parts tick every line on the check screen before anything is applied.
 */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !can(staff.role_id as RoleId, "priceParts")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Reading screenshots is not switched on yet: the ANTHROPIC_API_KEY is missing from the environment settings." }, { status: 503 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a picture first." }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "The picture is over 8 MB. Take a smaller screenshot." }, { status: 400 });
  const mediaType = MEDIA.has(file.type) ? file.type : "image/png";
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 6000, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data } }, { type: "text", text: PROMPT }] }] }),
    signal: AbortSignal.timeout(55_000),
  }).catch(() => null);
  if (!res) return NextResponse.json({ error: "The reading service did not answer. Try again." }, { status: 502 });
  const body = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string }; usage?: { input_tokens?: number; output_tokens?: number } };
  if (!res.ok) return NextResponse.json({ error: body.error?.message ?? `The reading service refused (${res.status}).` }, { status: 502 });
  const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let parsed: { headings?: unknown; rows?: unknown; totals?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    return NextResponse.json({ error: "The picture could not be read as a table. Try a sharper screenshot, or map the columns by hand." }, { status: 422 });
  }
  const headings = Array.isArray(parsed.headings) ? parsed.headings.map((h) => String(h ?? "")) : [];
  const rows = Array.isArray(parsed.rows) ? parsed.rows.filter(Array.isArray).map((r) => (r as unknown[]).map((c) => String(c ?? ""))) : [];
  const totals = Array.isArray(parsed.totals) ? parsed.totals.filter((t): t is { label: unknown; value: unknown } => !!t && typeof t === "object").map((t) => [String(t.label ?? ""), String(t.value ?? "")]) : [];
  if (!headings.length || !rows.length) return NextResponse.json({ error: "No table was found in the picture." }, { status: 422 });
  const result = readTable([headings, ...rows, ...totals]);
  return NextResponse.json({ result, model: MODEL, usage: body.usage ?? null });
}
