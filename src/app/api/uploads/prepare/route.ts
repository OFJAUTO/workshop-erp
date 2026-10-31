import { answer, contentTypeOf, readBody, refusal, scopeIdOf, senderOf, typesWords } from "@/lib/upload-door";
import { targetOf } from "@/lib/upload-targets";
import { UUID_RE, isRefusal, refuse, signedUpload } from "@/lib/upload-targets/common";

export const dynamic = "force-dynamic";

/**
 * Step 1 of THE upload door (31 October 2026): a one-time address (two hours) for one file, named by the browser's own
 * uuid so every try of the same file goes to the same object (a resumable video carries on; a file already there is not
 * sent twice - the answer says `exists`).
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return refusal(refuse("Bad request.", true, 400));
  const spec = targetOf(body.target);
  const scopeId = scopeIdOf(body);
  const fileId = String(body.fileId ?? "");
  if (!spec || !scopeId || !UUID_RE.test(fileId)) return refusal(refuse("Bad request.", true, 400));
  const contentType = contentTypeOf(body.contentType);
  const ext = spec.types[contentType];
  if (!ext) return refusal(refuse(`That kind of file is not accepted here. Use ${typesWords(spec)}.`, true, 400));
  const actor = await senderOf(spec, scopeId, body, contentType);
  if (isRefusal(actor)) return refusal(actor);
  const path = spec.path(scopeId, fileId.toLowerCase(), ext, body);
  if (isRefusal(path)) return refusal(path);
  const signed = await signedUpload(spec.bucket, path);
  if (isRefusal(signed)) return refusal(signed);
  return answer("exists" in signed ? { path, exists: true } : { path, url: signed.url });
}
