import "server-only";
import { isMash } from "./spell-rules";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";

/**
 * THE list of outside recovery companies (30 October 2026, night batch section 3.5): picked on the quotation's
 * recovery line, never typed freely. One list: the recovery companies table (name + phone, added with "+ Add new"),
 * plus the names saved before in Settings (the gate-out list and the quotation's learned names) until the owner tidies
 * them. A name that looks like a typing mistake ("YGHUHGHU", "SH") is flagged for the owner.
 */
export type RecoveryProvider = { name: string; phone: string | null; id: string | null; junk: boolean };

/** A name that looks like keyboard mashing or is too short to be a company or a person. */
export function looksLikeJunk(name: string): boolean {
  const letters = name.replace(/[^a-z]/gi, "");
  if (letters.length < 3) return true;
  return name.split(/\s+/).some((w) => isMash(w) || repeatsWithFewVowels(w));
}

/** "YGHUHGHU": a three-letter group typed twice in a word with a quarter of vowels or fewer ("Mississippi" is not). */
function repeatsWithFewVowels(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length < 6) return false;
  const vowels = (w.match(/[aeiou]/g) ?? []).length;
  if (vowels / w.length > 0.25) return false;
  for (let i = 0; i + 3 <= w.length; i++) if (w.indexOf(w.slice(i, i + 3), i + 1) > i) return true;
  return false;
}

export async function recoveryProviderList(settings: Settings): Promise<RecoveryProvider[]> {
  const { data } = await createAdminClient().from("recovery_companies").select("id, name, phone").eq("is_active", true).order("name");
  const out: RecoveryProvider[] = [];
  const seen = new Set<string>();
  const add = (name: string, phone: string | null, id: string | null) => {
    const clean = name.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    out.push({ name: clean, phone, id, junk: looksLikeJunk(clean) });
  };
  for (const r of (data ?? []) as { id: string; name: string; phone: string | null }[]) add(r.name, r.phone, r.id);
  for (const n of ((settings.recovery_companies ?? []) as string[]).concat((settings.recovery_providers ?? []) as string[])) add(String(n), null, null);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** "+ Add new": a company with its phone joins the list (or gets its phone, when the name was saved before). */
export async function addRecoveryProvider(name: string, phone: string | null, by: string): Promise<{ error?: string; provider?: RecoveryProvider }> {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length < 2) return { error: "Type the company's or the person's name." };
  if (looksLikeJunk(clean)) return { error: `"${clean}" does not look like a name. Type the company's or the person's real name.` };
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 7) return { error: "Type their phone number (so the office can call them)." };
  const admin = createAdminClient();
  const { data: existing } = await admin.from("recovery_companies").select("id").ilike("name", clean).maybeSingle();
  if (existing) {
    await admin.from("recovery_companies").update({ phone: digits, is_active: true, updated_by: by }).eq("id", existing.id);
    return { provider: { name: clean, phone: digits, id: existing.id as string, junk: false } };
  }
  const { data: row, error } = await admin.from("recovery_companies").insert({ name: clean, phone: digits, created_by: by, updated_by: by }).select("id").single();
  if (error || !row) return { error: "Could not save the company. Try again." };
  return { provider: { name: clean, phone: digits, id: row.id as string, junk: false } };
}

/** The owner removes a name from the list (a typing mistake): off the table and out of both Settings lists. */
export async function removeRecoveryProvider(name: string, settings: Settings, by: string): Promise<void> {
  const admin = createAdminClient();
  const key = name.trim().toLowerCase();
  await admin.from("recovery_companies").update({ is_active: false, updated_by: by }).ilike("name", name.trim());
  for (const k of ["recovery_companies", "recovery_providers"] as const) {
    const list = ((settings[k] ?? []) as string[]).map(String);
    const kept = list.filter((n) => n.trim().toLowerCase() !== key);
    if (kept.length !== list.length) await admin.from("settings").update({ value: kept, updated_by: by }).eq("key", k);
  }
}
