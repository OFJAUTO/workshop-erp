import "server-only";
import { createAdminClient } from "./supabase/admin";
import { passkeyPerson, passkeyRole, type PasskeyRollout } from "./passkey-rules";
import { passkeysOf, type PasskeyRow } from "./passkey-server";

/** The sign-in log and the phones, for the owner's pages and each person's "My sign-in" (7 November 2026). */

export type SignInLine = {
  at: string;
  kind: "sign_in" | "change";
  /** sign_in: the method; change: the change kind. */
  what: string;
  ok: boolean;
  detail: string | null;
  staffId: string | null;
  staffName: string | null;
  byName: string | null;
  device: string | null;
};

async function names(ids: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return new Map();
  const { data } = await createAdminClient().from("staff").select("id, display_name").in("id", uniq);
  return new Map((data ?? []).map((r) => [r.id as string, r.display_name as string]));
}

/** The newest sign-ins and changes (of one person, or everyone), newest first. */
export async function signInLog(opts: { staffId?: string; limit?: number } = {}): Promise<SignInLine[]> {
  const limit = opts.limit ?? 50;
  const admin = createAdminClient();
  let ev = admin.from("sign_in_events").select("staff_id, method, ok, reason, user_agent, at").order("at", { ascending: false }).limit(limit);
  let ch = admin.from("sign_in_changes").select("staff_id, kind, detail, by_staff_id, user_agent, at").order("at", { ascending: false }).limit(limit);
  if (opts.staffId) {
    ev = ev.eq("staff_id", opts.staffId);
    ch = ch.eq("staff_id", opts.staffId);
  }
  const [{ data: events, error: e1 }, { data: changes, error: e2 }] = await Promise.all([ev, ch]);
  if (e1) throw e1;
  if (e2) throw e2;
  const who = await names([...(events ?? []).map((e) => e.staff_id as string), ...(changes ?? []).flatMap((c) => [c.staff_id as string, c.by_staff_id as string])]);
  const lines: SignInLine[] = [
    ...(events ?? []).map((e) => ({
      at: e.at as string,
      kind: "sign_in" as const,
      what: e.method as string,
      ok: e.ok as boolean,
      detail: (e.reason as string | null) ?? null,
      staffId: (e.staff_id as string | null) ?? null,
      staffName: e.staff_id ? (who.get(e.staff_id as string) ?? null) : null,
      byName: null,
      device: deviceShort(e.user_agent as string | null),
    })),
    ...(changes ?? []).map((c) => ({
      at: c.at as string,
      kind: "change" as const,
      what: c.kind as string,
      ok: true,
      detail: (c.detail as string | null) ?? null,
      staffId: (c.staff_id as string | null) ?? null,
      staffName: c.staff_id ? (who.get(c.staff_id as string) ?? null) : null,
      byName: c.by_staff_id ? (who.get(c.by_staff_id as string) ?? null) : null,
      device: deviceShort(c.user_agent as string | null),
    })),
  ];
  return lines.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

/** "Edge on Windows", "Safari on iPhone"… from a stored browser string. */
export function deviceShort(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : "";
  return os ? `${browser} on ${os}` : browser;
}

export type PasskeyOverviewRow = {
  id: string;
  name: string;
  role: string;
  on: boolean;
  phones: number;
  lastPasskey: string | null;
  backupUses30: number;
  skips30: number;
  /** 9 November 2026: which devices hold the passkeys ("iPhone", "Android phone"…). */
  kinds: string[];
  /** This week's successful sign-ins: by passkey or by password, and from a phone/tablet or a PC. */
  week: { passkey: number; password: number; phone: number; pc: number };
};

/** A phone or tablet (iPhone, iPad, Android) vs a computer, from the stored browser string. */
export const isHandheldUa = (ua: string | null | undefined) => /iPhone|iPad|Android|Mobile/.test(ua ?? "");

/** Everyone in the passkey roles: phones, last passkey sign-in, password backup uses and skipped setups (30 days). */
export async function passkeyOverview(rollout: PasskeyRollout): Promise<PasskeyOverviewRow[]> {
  const admin = createAdminClient();
  const { data: staff, error } = await admin.from("staff").select("id, display_name, role_id, team, department_id").eq("is_active", true).order("display_name");
  if (error) throw error;
  const people = (staff ?? []).filter((s) => passkeyRole(s));
  const ids = people.map((p) => p.id as string);
  if (!ids.length) return [];
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: keys }, { data: events }, { data: skips }, { data: week }] = await Promise.all([
    admin.from("staff_passkeys").select("staff_id, name").in("staff_id", ids).is("removed_at", null),
    admin.from("sign_in_events").select("staff_id, method, ok, at").in("staff_id", ids).gte("at", since).in("method", ["passkey", "password_backup"]).eq("ok", true),
    admin.from("sign_in_changes").select("staff_id").in("staff_id", ids).eq("kind", "setup_skipped").gte("at", since),
    admin.from("sign_in_events").select("staff_id, method, user_agent").in("staff_id", ids).gte("at", weekAgo).eq("ok", true),
  ]);
  const kindsOf = new Map<string, string[]>();
  for (const k of (keys ?? []) as { staff_id: string; name: string | null }[]) kindsOf.set(k.staff_id, [...(kindsOf.get(k.staff_id) ?? []), k.name ?? "Device"]);
  const weekOf = new Map<string, { passkey: number; password: number; phone: number; pc: number }>();
  for (const e of (week ?? []) as { staff_id: string; method: string; user_agent: string | null }[]) {
    const w = weekOf.get(e.staff_id) ?? { passkey: 0, password: 0, phone: 0, pc: 0 };
    if (e.method === "passkey") w.passkey++;
    else if (/password|code|pin/.test(e.method)) w.password++;
    if (isHandheldUa(e.user_agent)) w.phone++;
    else w.pc++;
    weekOf.set(e.staff_id, w);
  }
  const phones = new Map<string, number>();
  for (const k of keys ?? []) phones.set(k.staff_id as string, (phones.get(k.staff_id as string) ?? 0) + 1);
  const lastPk = new Map<string, string>();
  const backup = new Map<string, number>();
  for (const e of events ?? []) {
    const id = e.staff_id as string;
    if (e.method === "passkey") {
      if (!lastPk.has(id) || (lastPk.get(id) as string) < (e.at as string)) lastPk.set(id, e.at as string);
    } else backup.set(id, (backup.get(id) ?? 0) + 1);
  }
  const skipped = new Map<string, number>();
  for (const s of skips ?? []) skipped.set(s.staff_id as string, (skipped.get(s.staff_id as string) ?? 0) + 1);
  return people.map((p) => ({
    id: p.id as string,
    name: p.display_name as string,
    role: p.role_id as string,
    on: passkeyPerson(p, rollout),
    phones: phones.get(p.id as string) ?? 0,
    lastPasskey: lastPk.get(p.id as string) ?? null,
    backupUses30: backup.get(p.id as string) ?? 0,
    skips30: skipped.get(p.id as string) ?? 0,
    kinds: kindsOf.get(p.id as string) ?? [],
    week: weekOf.get(p.id as string) ?? { passkey: 0, password: 0, phone: 0, pc: 0 },
  }));
}

export type PhoneLine = Pick<PasskeyRow, "id" | "name" | "created_at" | "last_used_at" | "removed_at" | "removed_reason"> & { removedBy: string | null };

/** A person's phones, the removed ones too (who removed them and why). */
export async function phonesOf(staffId: string, opts: { withRemoved?: boolean } = {}): Promise<PhoneLine[]> {
  const rows = await passkeysOf(staffId, opts);
  const who = await names(rows.map((r) => r.removed_by ?? "").filter(Boolean));
  return rows.map((r) => ({ id: r.id, name: r.name, created_at: r.created_at, last_used_at: r.last_used_at, removed_at: r.removed_at, removed_reason: r.removed_reason, removedBy: r.removed_by ? (who.get(r.removed_by) ?? null) : null }));
}
