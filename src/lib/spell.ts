import "server-only";
import { contextOf, isMash, skipToken, tokens, WORKSHOP_WORDS, type SpellIssue } from "./spell-rules";
import { getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";

/**
 * The pre-send spelling check (23 October 2026): British and American English dictionaries (Hunspell, through
 * nspell), the built-in workshop words, the owner's own list (Settings > Workshop dictionary), the known words for
 * capitals, and every make and model on our list. Loaded once per server instance.
 */
type Checker = { correct: (w: string) => boolean; suggest: (w: string) => string[]; add: (w: string) => unknown };
let base: Promise<Checker> | null = null;

async function loadBase(): Promise<Checker> {
  const [{ default: nspell }, { default: gb }, { default: us }] = await Promise.all([import("nspell"), import("dictionary-en-gb"), import("dictionary-en")]);
  const british = nspell({ aff: Buffer.from(gb.aff), dic: Buffer.from(gb.dic) }) as unknown as Checker;
  // American spellings are not mistakes either (stabilizer, color). Each word list keeps its own affix rules (one
  // list loaded on the other's rules accepts everything), so a word is fine when either dictionary knows it.
  const american = nspell({ aff: Buffer.from(us.aff), dic: Buffer.from(us.dic) }) as unknown as Checker;
  for (const w of WORKSHOP_WORDS) british.add(w);
  return { correct: (w) => british.correct(w) || american.correct(w), suggest: (w) => british.suggest(w), add: (w) => british.add(w) };
}

/** The words this workshop added (Settings) plus the car makes and models: refreshed on every check, cheap. */
async function extraWords(): Promise<Set<string>> {
  const settings = await getSettings();
  const own = [...((settings.spell_words ?? []) as string[]), ...((settings.known_words ?? []) as string[])];
  const admin = createAdminClient();
  const [{ data: makes }, { data: models }] = await Promise.all([admin.from("vehicle_makes").select("name").eq("is_active", true), admin.from("vehicle_models").select("name").eq("is_active", true)]);
  const out = new Set<string>();
  for (const w of [...own, ...(makes ?? []).map((m) => m.name as string), ...(models ?? []).map((m) => m.name as string)]) for (const part of String(w).split(/[\s/-]+/)) if (part) out.add(part.toLowerCase());
  return out;
}

/** Every suspicious word in some texts: not in the dictionaries (with up to four suggestions), or keyboard mash. */
export async function checkTexts(texts: { key: string; text: string }[]): Promise<(SpellIssue & { key: string })[]> {
  if (!base) base = loadBase();
  const [spell, extra] = await Promise.all([base, extraWords()]);
  const out: (SpellIssue & { key: string })[] = [];
  for (const { key, text } of texts) {
    if (!text?.trim()) continue;
    const letters = text.replace(/[^A-Za-z]/g, "");
    const allCaps = letters.length > 3 && letters === letters.toUpperCase();
    const seen = new Set<string>();
    for (const { word, index } of tokens(text)) {
      if (skipToken(word, allCaps)) continue;
      const lower = word.toLowerCase();
      if (seen.has(lower) || extra.has(lower)) continue;
      // Text typed in capitals is checked in lower case; a normal word keeps its own case (names are checked as typed).
      // A word the dictionary knows is never called random typing ("slight" has few vowels and is fine).
      if (spell.correct(word) || spell.correct(lower) || spell.correct(lower[0].toUpperCase() + lower.slice(1))) continue;
      const mash = isMash(word);
      seen.add(lower);
      const suggestions = mash ? [] : spell.suggest(allCaps ? lower : word).slice(0, 4).map((s) => (allCaps ? s.toUpperCase() : s));
      out.push({ key, word, kind: mash ? "mash" : "misspelled", suggestions, context: contextOf(text, index, word) });
    }
  }
  return out;
}
