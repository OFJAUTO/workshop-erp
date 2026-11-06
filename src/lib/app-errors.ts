import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uuid";
import { SAVE_FAILED_WORDS, isRawDbText, staffDetail, staffWords } from "@/lib/db-words";

/**
 * Failed saves (26 October 2026): staff never see the database's own words. They get one plain sentence; the
 * technical error is written to app_errors (server only) and the server log, for the owner to read
 * (Settings > Problems behind the scenes).
 */
export const SAVE_FAILED = SAVE_FAILED_WORDS;

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Writes the technical error down; never throws (a failing log must not break the screen). */
export async function logAppError(place: string, err: unknown, ctx: { staffId?: string | null; jobId?: string | null; detail?: Record<string, unknown> } = {}): Promise<void> {
  const message = errorText(err).slice(0, 1000);
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : null;
  console.error(`[app-error] ${place}: ${message}`);
  try {
    await createAdminClient()
      .from("app_errors")
      .insert({ place, message, detail: { ...(ctx.detail ?? {}), ...(code ? { code } : {}) }, staff_id: isUuid(ctx.staffId) ? ctx.staffId : null, job_id: isUuid(ctx.jobId) ? ctx.jobId : null });
  } catch {
    // The server log above still has it.
  }
}

type Ctx = { staffId?: string | null; jobId?: string | null; detail?: Record<string, unknown> };

/** A database error object: a Postgres code (5 characters, never our own trigger's P0001 words) or PostgREST's. */
function isDbError(err: unknown): boolean {
  if (isRawDbText(errorText(err))) return true;
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code ?? "") : "";
  return code !== "P0001" && /^([0-9][0-9A-Z]{4}|PGRST\d{3})$/.test(code);
}

/** The log is written after the answer is sent, so a slow log never holds the screen up. */
function logLater(place: string, err: unknown, ctx: Ctx) {
  try {
    after(() => logAppError(place, err, ctx));
  } catch {
    void logAppError(place, err, ctx);
  }
}

/**
 * THE words staff see for an error (6 November 2026). Our own sentences pass through; a database error becomes its
 * plain advice or the shared SAVE_FAILED sentence, and the raw text goes to the owner's log.
 */
export function dbWords(err: unknown, place: string, ctx: Ctx = {}): string {
  const text = errorText(err);
  if (!isDbError(err)) return text;
  logLater(place, err, ctx);
  const plain = staffWords(text);
  return plain === text ? SAVE_FAILED_WORDS : plain;
}

/** The same, for a database error INSIDE one of our sentences ("Could not copy the lines: …"). */
export function dbDetail(err: unknown, place: string, ctx: Ctx = {}): string {
  const text = errorText(err);
  if (!isDbError(err)) return text;
  logLater(place, err, ctx);
  const plain = staffDetail(text);
  return plain === text ? "a problem behind the scenes (the owner has the detail)" : plain;
}
