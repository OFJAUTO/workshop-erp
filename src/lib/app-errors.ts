import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uuid";

/**
 * Failed saves (26 October 2026): staff never see the database's own words. They get one plain sentence; the
 * technical error is written to app_errors (server only) and the server log, for us to read.
 */
export const SAVE_FAILED = "Couldn't save – nothing was recorded. Try again or tell the owner.";

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
