import "server-only";
import { readTable, type ImportResult } from "./price-import";

const MODEL = process.env.ANTHROPIC_OCR_MODEL || "claude-sonnet-5-5";

const PROMPT = `This is a screenshot of a car parts supplier's price list or quotation. Read the table exactly as printed.
Reply with JSON only, no words around it, in this shape:
{"headings": ["...", "..."], "rows": [["cell", "cell", ...], ...], "totals": [{"label": "Gross Amount", "value": "11,853.00"}]}
Rules: one entry per column heading, in order; one row per part line with one cell per heading, every cell the exact text you see (keep commas and spaces in numbers and part numbers); a cell you cannot read with confidence is "" (empty), never a guess; totals, VAT and grand totals go under "totals" with their label, never as rows; nothing that is not in the picture.`;

/** The screenshot reader is on when the key exists in the environment; the key never reaches the browser. */
export const ocrEnabled = () => !!process.env.ANTHROPIC_API_KEY;

/**
 * Reads a supplier's table out of a picture with the Anthropic API (vision): a screenshot, or one page of a
 * scanned PDF. The answer goes through the same reader as a file, and Parts tick every line before anything
 * is applied.
 */
export async function ocrTable(data: Uint8Array | Buffer, mediaType: string): Promise<{ result?: ImportResult; error?: string; status?: number; model?: string; usage?: unknown }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "Reading screenshots is not switched on yet: the ANTHROPIC_API_KEY is missing from the environment settings.", status: 503 };
  if (data.byteLength > 8 * 1024 * 1024) return { error: "The picture is over 8 MB. Take a smaller screenshot.", status: 400 };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 6000, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: Buffer.from(data).toString("base64") } }, { type: "text", text: PROMPT }] }] }),
    signal: AbortSignal.timeout(55_000),
  }).catch(() => null);
  if (!res) return { error: "The reading service did not answer. Try again.", status: 502 };
  const body = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string }; usage?: { input_tokens?: number; output_tokens?: number } };
  if (!res.ok) return { error: body.error?.message ?? `The reading service refused (${res.status}).`, status: 502 };
  const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let parsed: { headings?: unknown; rows?: unknown; totals?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    return { error: "The picture could not be read as a table. Try a sharper screenshot, or map the columns by hand.", status: 422 };
  }
  const headings = Array.isArray(parsed.headings) ? parsed.headings.map((h) => String(h ?? "")) : [];
  const rows = Array.isArray(parsed.rows) ? parsed.rows.filter(Array.isArray).map((r) => (r as unknown[]).map((c) => String(c ?? ""))) : [];
  const totals = Array.isArray(parsed.totals) ? parsed.totals.filter((t): t is { label: unknown; value: unknown } => !!t && typeof t === "object").map((t) => [String(t.label ?? ""), String(t.value ?? "")]) : [];
  if (!headings.length || !rows.length) return { error: "No table was found in the picture.", status: 422 };
  return { result: readTable([headings, ...rows, ...totals]), model: MODEL, usage: body.usage ?? null };
}
