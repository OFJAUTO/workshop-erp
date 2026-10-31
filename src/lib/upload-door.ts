import "server-only";
import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { readGrant, readGrantAnyTime, type UploadTarget } from "@/lib/upload-grant";
import { isRefusal, refuse, takenAtOf, UUID_RE, type Actor, type Refusal, type TargetSpec, type UploadBody } from "@/lib/upload-targets/common";

/**
 * The parts of /api/uploads/{grant,prepare,register} they share (31 October 2026): reading the body, the place, who is
 * sending (the sending permit when it is genuine, else the session or the phone link), and the answers in plain words
 * with `permanent` set when trying again can never help - the phone's queue stops those instead of retrying for ever.
 */
export async function readBody(request: Request): Promise<UploadBody | null> {
  try {
    const b = (await request.json()) as unknown;
    return b && typeof b === "object" && !Array.isArray(b) ? (b as UploadBody) : null;
  } catch {
    return null;
  }
}

export const answer = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const refusal = (r: Refusal) => answer({ error: r.error, permanent: r.permanent }, r.status);

export function contentTypeOf(raw: unknown): string {
  return String(raw ?? "").split(";")[0].trim().toLowerCase();
}

/** The place's id: a uuid (a job, an inspection, an LPO, a commission payment, a part). */
export function scopeIdOf(body: UploadBody): string | null {
  const s = String(body.scopeId ?? "");
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

/** "Use a photo, a video or a PDF." from what the place accepts. */
export function typesWords(spec: TargetSpec): string {
  const t = Object.keys(spec.types);
  const parts = [t.some((x) => x.startsWith("image/")) ? "a photo" : null, t.some((x) => x.startsWith("video/")) ? "a video" : null, t.includes("application/pdf") ? "a PDF" : null].filter(Boolean) as string[];
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}` : (parts[0] ?? "a file");
}

/**
 * Who is sending: a genuine permit for this exact place first (it outlives the session), else the session or the phone
 * link. A permit that ran out falls back to the session; with neither, the file waits for the person to sign in again.
 */
export async function senderOf(spec: TargetSpec, scopeId: string, body: UploadBody, contentType: string | null): Promise<Actor | Refusal> {
  const takenAt = takenAtOf(body.takenAt);
  const g = body.grant ? readGrant(body.grant, spec.target as UploadTarget, scopeId) : null;
  if (g) return spec.authoriseGrant(scopeId, g, body, contentType, takenAt);
  // The permit ran out (or there is none). Whose file is it: the taker named with the file, or the one its old permit names.
  const old = body.grant ? readGrantAnyTime(body.grant, spec.target as UploadTarget, scopeId) : null;
  const takenBy = typeof body.takenBy === "string" && UUID_RE.test(body.takenBy) ? body.takenBy.toLowerCase() : null;
  const holder = (old?.u ?? takenBy)?.toLowerCase() ?? null;
  if (holder && !body.token) {
    const me = await getCurrentStaff();
    // Someone else is signed in on this device: the file waits for its taker - never sent, nor refused for good, on
    // someone else's rights.
    if (me && me.id.toLowerCase() !== holder) return refuse("Taken by another person – it sends when they sign in on this device.", false, 401);
    // The taker is signed in again: their old permit still proves when the file was taken (a report closed meanwhile).
    if (me && old && !me.viewingAs) return spec.authoriseGrant(scopeId, old, body, contentType, takenAt);
  }
  const viaSession = await spec.authorise(scopeId, body, contentType);
  if (isRefusal(viaSession) && body.grant && viaSession.status === 401) {
    // A PIN-only section tablet can never sign in again: a permit of its that ran out (12 hours without signal) is final.
    if (old?.via === "pin") return refuse("Too long without signal – take the photo again on the tablet.", true, 410);
    return refuse("The sending permit ran out. Sign in again and it will send.", false, 401);
  }
  return viaSession;
}
