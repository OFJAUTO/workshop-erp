import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { checkTexts } from "@/lib/spell";

export const dynamic = "force-dynamic";

/**
 * The spelling check WHILE TYPING (1 November 2026): the text of the box being typed in. Returns the words to
 * underline (misspelled with up to four suggestions, or keyboard mash). Names and car words are in the shared
 * dictionary and never come back. A reminder only: nothing is ever blocked.
 */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = typeof body.text === "string" ? body.text.slice(0, 5000) : "";
  const issues = text.trim() ? await checkTexts([{ key: "t", text }]) : [];
  return NextResponse.json({
    flagged: issues.map((i) => ({ word: i.word, kind: i.kind, suggestions: i.suggestions })),
    canAdd: (staff.role_id === "owner" || staff.role_id === "service_advisor") && !staff.viewingAs,
  });
}
