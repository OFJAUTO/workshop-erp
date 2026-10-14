import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { ocrTable } from "@/lib/import-ocr";
import { can, type RoleId } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MEDIA = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * Reads a supplier's table out of a screenshot (src/lib/import-ocr.ts). Off until ANTHROPIC_API_KEY exists in
 * the environment; the key is never sent to the browser. Parts tick every line on the check screen before
 * anything is applied.
 */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !can(staff.role_id as RoleId, "priceParts")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a picture first." }, { status: 400 });
  const mediaType = MEDIA.has(file.type) ? file.type : "image/png";
  const r = await ocrTable(Buffer.from(await file.arrayBuffer()), mediaType);
  if (r.error || !r.result) return NextResponse.json({ error: r.error ?? "The picture could not be read." }, { status: r.status ?? 502 });
  return NextResponse.json({ result: r.result, model: r.model, usage: r.usage ?? null });
}
