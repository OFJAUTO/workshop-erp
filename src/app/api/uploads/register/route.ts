import { answer, contentTypeOf, readBody, refusal, scopeIdOf, senderOf } from "@/lib/upload-door";
import { targetOf } from "@/lib/upload-targets";
import { isRefusal, objectExists, refuse, takenAtOf } from "@/lib/upload-targets/common";

export const dynamic = "force-dynamic";

const TYPE_OF_EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", webm: "video/webm", mp4: "video/mp4", mov: "video/quicktime", pdf: "application/pdf" };

/**
 * Step 2 of THE upload door (31 October 2026): the file is in storage, so it is recorded against its place, under the
 * person who took it, with the time they took it. Safe to call again for the same file (the answer was lost on the way
 * back): it answers with the row already made.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return refusal(refuse("Bad request.", true, 400));
  const spec = targetOf(body.target);
  const scopeId = scopeIdOf(body);
  const path = String(body.path ?? "");
  if (!spec || !scopeId || !path || !spec.owns(scopeId, path)) return refusal(refuse("Bad request.", true, 400));
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const contentType = body.contentType ? contentTypeOf(body.contentType) : (TYPE_OF_EXT[ext] ?? null);
  const actor = await senderOf(spec, scopeId, body, contentType);
  if (isRefusal(actor)) return refusal(actor);
  if (!(await objectExists(spec.bucket, path))) return refusal(refuse("The file has not fully arrived yet. It will be sent again.", false, 409));
  const done = await spec.register({ scopeId, path, actor, body, takenAt: new Date(takenAtOf(body.takenAt)).toISOString(), contentType });
  if (isRefusal(done)) return refusal(done);
  return answer(done);
}
