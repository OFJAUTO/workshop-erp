import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { checkTexts } from "@/lib/spell";
import { documentTexts, type SpellSource } from "@/lib/spell-docs";

export const dynamic = "force-dynamic";

/**
 * The pre-send spelling check: the message about to go out and, when given, the document behind the link. Returns
 * the suspicious words (misspelled with suggestions, or keyboard mash) with where they are. A reminder, never a block.
 */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { message?: string; source?: SpellSource | null };
  const texts: { key: string; label: string; text: string }[] = [];
  if (typeof body.message === "string" && body.message.trim()) texts.push({ key: "message", label: "The message", text: body.message.slice(0, 5000) });
  const s = body.source;
  if (s && ((s.kind === "quotation" && typeof s.id === "string") || (s.kind === "report" && typeof s.jobId === "string") || (s.kind === "invoice" && typeof s.token === "string"))) texts.push(...(await documentTexts(s)));
  const issues = await checkTexts(texts.map((t) => ({ key: t.key, text: t.text })));
  const labelOf = new Map(texts.map((t) => [t.key, t.label]));
  return NextResponse.json({ issues: issues.map((i) => ({ ...i, label: labelOf.get(i.key) ?? "" })), canAddWords: staff.role_id === "owner" && !staff.viewingAs });
}
