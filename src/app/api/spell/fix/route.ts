import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { rememberSpellWord } from "@/lib/spell";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * "Add to dictionary" under an underlined word (the owner and the service advisors, 1 November 2026): the word goes
 * into the workshop dictionary (Settings > Workshop dictionary) and is never underlined again, for anyone.
 */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  if (staff.role_id !== "owner" && staff.role_id !== "service_advisor") return NextResponse.json({ error: "The owner and the service advisors add words to the dictionary." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { addWord?: string };
  const word = String(body.addWord ?? "").replace(/[^\p{L}\p{N}'/-]/gu, "").slice(0, 40);
  if (word.length < 2) return NextResponse.json({ error: "Not a word." }, { status: 400 });
  const settings = await getSettings();
  const now = (settings.spell_words ?? []) as string[];
  if (!now.some((w) => w.toLowerCase() === word.toLowerCase())) {
    const { error } = await createAdminClient().from("settings").upsert({ key: "spell_words", label: "Workshop dictionary (spell check)", value: [...now, word], updated_by: staff.id }, { onConflict: "key" });
    if (error) return NextResponse.json({ error: "Couldn't save – try again." }, { status: 500 });
  }
  rememberSpellWord(word);
  return NextResponse.json({ ok: true, added: word });
}
