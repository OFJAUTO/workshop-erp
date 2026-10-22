import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { applySpellFix } from "@/lib/spell-docs";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * The spelling check's buttons: { key, word, replacement } fixes the word where it is stored; { addWord } (the
 * owner) adds a word to the workshop dictionary so it is never flagged again.
 */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  if (staff.role_id === "technician" || staff.role_id === "gate_in") return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { key?: string; word?: string; replacement?: string; addWord?: string };
  if (body.addWord) {
    if (staff.role_id !== "owner") return NextResponse.json({ error: "Only the owner adds words to the workshop dictionary." }, { status: 403 });
    const word = String(body.addWord).replace(/[^\p{L}\p{N}'/-]/gu, "").slice(0, 40);
    if (word.length < 2) return NextResponse.json({ error: "Not a word." }, { status: 400 });
    const settings = await getSettings();
    const list = Array.from(new Set([...((settings.spell_words ?? []) as string[]), word]));
    await createAdminClient().from("settings").upsert({ key: "spell_words", label: "Workshop dictionary (spell check)", value: list, updated_by: staff.id }, { onConflict: "key" });
    return NextResponse.json({ ok: true, added: word });
  }
  if (!body.key || !body.word || typeof body.replacement !== "string") return NextResponse.json({ error: "Missing the word." }, { status: 400 });
  const r = await applySpellFix(body.key, body.word, body.replacement.slice(0, 80), staff.id);
  return r.error ? NextResponse.json({ error: r.error }, { status: 409 }) : NextResponse.json({ ok: true, text: r.text });
}
