import "server-only";
import { contextOf, isMash, skipToken, tokens, WORKSHOP_WORDS, type SpellIssue } from "./spell-rules";
import { getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";

/**
 * The spelling check (23 October 2026; while typing from 1 November 2026): British and American English
 * dictionaries (Hunspell, through nspell), the built-in workshop words, and the workshop's shared dictionary - the
 * words added with "Add to dictionary" (Settings > Workshop dictionary), the known words for capitals, every make
 * and model, every customer, contact, staff and supplier name, the parts list, the services, and the tyre brands -
 * so a name or a car word is never underlined. The dictionaries load once per server instance; the shared words are
 * kept for five minutes.
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

const SHARED_MS = 5 * 60 * 1000;
let shared: { at: number; words: Promise<Set<string>> } | null = null;
/** Words added on this server since the shared list was read (an added word counts at once, here). */
const addedHere = new Set<string>();

/** Every row of a column, past PostgREST's 1,000-row page. */
async function allOf(table: string, columns: string, active = true): Promise<Record<string, unknown>[]> {
  const admin = createAdminClient();
  const out: Record<string, unknown>[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    let q = admin.from(table).select(columns).range(from, from + 999);
    if (active) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error || !data?.length) break;
    out.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < 1000) break;
  }
  return out;
}

async function loadShared(): Promise<Set<string>> {
  const settings = await getSettings();
  const s = settings as unknown as Record<string, unknown>;
  const list = (k: string) => (Array.isArray(s[k]) ? (s[k] as unknown[]).map(String) : []);
  const tyreModels = Object.entries((s.tyre_models as Record<string, string[]> | null) ?? {}).flatMap(([b, ms]) => [b, ...(ms ?? [])]);
  const [makes, models, customers, contacts, staff, suppliers, catalogue, services] = await Promise.all([
    allOf("vehicle_makes", "name"),
    allOf("vehicle_models", "name"),
    allOf("customers", "full_name, company_name", false),
    allOf("customer_contacts", "name", false),
    allOf("staff", "display_name, full_name", false),
    allOf("suppliers", "name", false),
    allOf("part_catalogue", "name", false),
    allOf("services", "name", false),
  ]);
  const words = [
    ...list("spell_words"),
    ...list("known_words"),
    ...list("tyre_brands"),
    ...list("tyre_brand_custom"),
    ...list("premium_brands"),
    ...list("recovery_companies"),
    ...tyreModels,
    ...[makes, models, customers, contacts, staff, suppliers, catalogue, services].flat().flatMap((r) => Object.values(r).map((v) => String(v ?? ""))),
  ];
  const out = new Set<string>();
  for (const w of words) for (const part of w.split(/[\s/.,()&+-]+/)) if (part) out.add(part.toLowerCase().replace(/['’]s$/, ""));
  return out;
}

async function sharedWords(): Promise<Set<string>> {
  if (!shared || Date.now() - shared.at > SHARED_MS) {
    const words = loadShared();
    shared = { at: Date.now(), words };
    words.catch(() => { shared = null; });
  }
  const set = await shared.words;
  for (const w of addedHere) set.add(w);
  return set;
}

/** "Add to dictionary" (owner and advisors): the word counts for everyone, at once on this server. */
export function rememberSpellWord(word: string) {
  addedHere.add(word.toLowerCase());
}

/** The word with each pair of neighbouring letters swapped. */
function swapsOf(w: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < w.length - 1; i++) if (w[i] !== w[i + 1]) out.push(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
  return out;
}
const lowerIf = (yes: boolean) => (s: string) => (yes ? s.toLowerCase() : s);

/** Every suspicious word in some texts: not in the dictionaries (with up to four suggestions), or keyboard mash. */
export async function checkTexts(texts: { key: string; text: string }[]): Promise<(SpellIssue & { key: string })[]> {
  if (!base) base = loadBase();
  const [spell, extra] = await Promise.all([base, sharedWords()]);
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
      // Two letters swapped is the commonest slip ("ADN" -> "AND", "teh" -> "the"): those words come first.
      const swaps = mash ? [] : swapsOf(lower).filter((w) => spell.correct(w));
      const suggestions = mash ? [] : Array.from(new Set([...swaps, ...spell.suggest(allCaps ? lower : word).map(lowerIf(allCaps))])).slice(0, 4).map((s) => (allCaps ? s.toUpperCase() : s));
      out.push({ key, word, kind: mash ? "mash" : "misspelled", suggestions, context: contextOf(text, index, word) });
    }
  }
  return out;
}
