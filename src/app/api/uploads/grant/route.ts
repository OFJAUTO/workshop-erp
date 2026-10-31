import { answer, contentTypeOf, readBody, refusal, scopeIdOf } from "@/lib/upload-door";
import { mintGrant, type UploadTarget } from "@/lib/upload-grant";
import { targetOf } from "@/lib/upload-targets";
import { isRefusal, refuse } from "@/lib/upload-targets/common";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * A sending permit for one place, handed out while the person may add files there (31 October 2026). The browser keeps it
 * with every file it queues, so the file still arrives after a sign-out, an idle lock or the phone link's end.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return refusal(refuse("Bad request.", true, 400));
  const spec = targetOf(body.target);
  const scopeId = scopeIdOf(body);
  if (!spec || !scopeId) return refusal(refuse("Bad request.", true, 400));
  const actor = await spec.authorise(scopeId, body, body.contentType ? contentTypeOf(body.contentType) : null);
  if (isRefusal(actor)) return refusal(actor);
  const { grant, expiresAt } = mintGrant({ t: spec.target as UploadTarget, s: scopeId, u: actor.staffId, via: actor.via });
  // Who the files will be recorded under: the queue shows "waiting for <name>" and never renews it for someone else.
  const { data: who } = actor.staffId ? await createAdminClient().from("staff").select("display_name").eq("id", actor.staffId).maybeSingle() : { data: null };
  return answer({ grant, expiresAt, staffId: actor.staffId, staffName: (who?.display_name as string | undefined) ?? null });
}
