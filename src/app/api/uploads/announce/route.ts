import { answer, readBody, scopeIdOf } from "@/lib/upload-door";
import { getCurrentStaff } from "@/lib/auth";
import { getCurrentDevice } from "@/lib/devices";
import { readGrantAnyTime, type UploadTarget } from "@/lib/upload-grant";
import { recordAnnounce } from "@/lib/upload-pending";

export const dynamic = "force-dynamic";

const TARGETS = new Set(["gate_in", "inspection", "job_file", "supplier_proof", "commission_proof", "credit_note", "loose_item", "estimate_report"]);
const STATES = new Set(["waiting", "sending", "stopped", "removed"]);

/**
 * The tablet's news about a file saved on it (12 November 2026): "saved here", "sending 40%", "could not be sent",
 * "removed". Only facts about the file are kept (no file); it lets the report say "4 files still uploading from Mech 3".
 * Taken from a genuine sending permit for that place (even one that ran out) or a signed-in person.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return answer({ ok: false }, 400);
  const target = String(body.target ?? "");
  const scopeId = scopeIdOf(body);
  const fileId = String(body.fileId ?? "");
  if (!TARGETS.has(target) || !scopeId || !fileId) return answer({ ok: false }, 400);
  const grant = body.grant ? readGrantAnyTime(body.grant, target as UploadTarget, scopeId) : null;
  const staff = grant ? null : await getCurrentStaff();
  if (!grant && !staff) return answer({ ok: false }, 401);
  const device = await getCurrentDevice().catch(() => null);
  const state = STATES.has(String(body.state)) ? (String(body.state) as "waiting" | "sending" | "stopped" | "removed") : "waiting";
  const storage = body.storage && typeof body.storage === "object" ? (body.storage as { quotaMb?: number; usedMb?: number; persisted?: boolean }) : null;
  const ok = await recordAnnounce(
    {
      fileId,
      target,
      scopeId,
      itemKey: typeof body.itemKey === "string" ? body.itemKey : null,
      kind: typeof body.kind === "string" ? body.kind : null,
      contentType: typeof body.contentType === "string" ? body.contentType : null,
      size: typeof body.size === "number" ? body.size : null,
      staffId: grant?.u ?? (typeof body.takenBy === "string" ? body.takenBy : staff?.id ?? null),
      takenAt: typeof body.takenAt === "number" ? body.takenAt : null,
      state,
      progress: typeof body.progress === "number" ? body.progress : null,
      attempts: typeof body.attempts === "number" ? body.attempts : null,
      error: typeof body.error === "string" ? body.error : null,
      storage,
    },
    device ? { id: device.id, name: device.name } : null,
  );
  return answer({ ok });
}
