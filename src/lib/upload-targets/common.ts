import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UploadGrant, UploadTarget } from "@/lib/upload-grant";

/**
 * THE upload door's shared shapes (31 October 2026, uploads section 10). Every staff upload goes prepare -> straight to
 * storage -> register through /api/uploads/*, and each kind of place (a job's gate-in media, an inspection, the job files,
 * an LPO's payment proof, ...) is one `TargetSpec` in this folder. The browser names each file with its own uuid, so the
 * object's path is the same on every try: a resend continues the same object (resumable videos) and a repeated register
 * answers with the row already made instead of a second one.
 */
export type UploadBody = Record<string, unknown>;

/** Who the file is recorded under, and how that was proved. */
export type Actor = { staffId: string | null; roleId: string | null; via: "login" | "link" | "pin" };

/** A refusal in plain words. `permanent`: trying again can never help (wrong type, not allowed, the place is closed). */
export type Refusal = { error: string; permanent: boolean; status: number };

export type Registered = { ok: true; id: string | null; path: string; url: string | null } & Record<string, unknown>;

export type RegisterContext = {
  scopeId: string;
  path: string;
  actor: Actor;
  body: UploadBody;
  /** When the person took the file (ISO, already checked). */
  takenAt: string;
  contentType: string | null;
};

export type TargetSpec = {
  target: UploadTarget;
  bucket: string;
  /** Accepted content types and the file ending each gets. */
  types: Record<string, string>;
  /** Who may add files here right now (the session, or a phone-link token in the body). */
  authorise(scopeId: string, body: UploadBody, contentType: string | null): Promise<Actor | Refusal>;
  /** Whether the permit's holder may still add this file (the permit proves who, takenAt says when). */
  authoriseGrant(scopeId: string, grant: UploadGrant, body: UploadBody, contentType: string | null, takenAt: number): Promise<Actor | Refusal>;
  /** The object's path: the same for the same fileId, so a resend continues the same object. */
  path(scopeId: string, fileId: string, ext: string, body: UploadBody): string | Refusal;
  /** A path belongs to this place (checked before anything is recorded). */
  owns(scopeId: string, path: string): boolean;
  /** Records the stored file. Safe to call twice for the same path: the second call answers with the first row. */
  register(ctx: RegisterContext): Promise<Registered | Refusal>;
};

export const refuse = (error: string, permanent: boolean, status = permanent ? 403 : 409): Refusal => ({ error, permanent, status });
export const isRefusal = (x: unknown): x is Refusal => !!x && typeof x === "object" && "error" in x && "permanent" in x;

export const NOT_ALLOWED = "You can't add files here any more (no permission, or the place is closed).";

/** The database did not answer (a hiccup): never a refusal for good - the file tries again by itself. */
export const checkLater = (): Refusal => refuse("Couldn't check right now – it will try again by itself.", false, 503);

/** Whether a row exists: true / false, or null when the database could not be asked. */
export async function rowExists(table: string, id: string, extra?: Record<string, string>): Promise<boolean | null> {
  let q = createAdminClient().from(table).select("id").eq("id", id);
  for (const [k, v] of Object.entries(extra ?? {})) q = q.eq(k, v);
  const { data, error } = await q.maybeSingle();
  if (error) return null;
  return !!data;
}

/** The person a permit names: still active, with their role (a permit never outlives the person's access). */
export async function grantActor(g: UploadGrant): Promise<Actor | Refusal> {
  if (!g.u) return { staffId: null, roleId: null, via: g.via };
  const { data, error } = await createAdminClient().from("staff").select("id, role_id, is_active").eq("id", g.u).maybeSingle();
  if (error) return checkLater();
  if (!data || !data.is_active) return refuse(NOT_ALLOWED, true);
  return { staffId: data.id as string, roleId: String(data.role_id), via: g.via };
}

/** Whether the object really arrived in storage (never record a file that is not there). */
export async function objectExists(bucket: string, path: string): Promise<boolean> {
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data } = await createAdminClient().storage.from(bucket).list(folder, { search: name, limit: 1 });
  return !!data?.some((f) => f.name === name);
}

/**
 * When the person took the file, as the browser says, kept within sense: never in the future, never more than 14 days back
 * (a queued file can wait on a phone for days, not weeks). Anything else is "now".
 */
export function takenAtOf(raw: unknown, now = Date.now()): number {
  const t = typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : NaN;
  if (!Number.isFinite(t)) return now;
  if (t > now + 2 * 60_000) return now;
  if (t < now - 14 * 86_400_000) return now;
  return Math.min(t, now);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The bucket's own signed address for a new object (two hours), or "already there". */
export async function signedUpload(bucket: string, path: string): Promise<{ url: string } | { exists: true } | Refusal> {
  if (await objectExists(bucket, path)) return { exists: true };
  const { data, error } = await createAdminClient().storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) {
    if (/exist|duplicate/i.test(String(error?.message ?? ""))) return { exists: true };
    return refuse("Could not prepare the upload. It will try again by itself.", false, 500);
  }
  return { url: data.signedUrl };
}

/** A short-lived address to show the stored file (the page shows it straight away). */
export async function signedView(bucket: string, path: string): Promise<string | null> {
  const { data } = await createAdminClient().storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
