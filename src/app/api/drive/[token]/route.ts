import { NextResponse, type NextRequest } from "next/server";
import { completeTripByDriver } from "@/lib/delivery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The driver's one button: the photo and his price in one POST. The link is dead once used. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "The photo did not come through. Try again." }, { status: 400 });
  }
  const photo = form.get("photo");
  const price = Number(String(form.get("price") ?? "").replace(",", "."));
  if (!(photo instanceof File)) return NextResponse.json({ error: "Take the photo first." }, { status: 400 });
  const bytes = Buffer.from(await photo.arrayBuffer());
  const r = await completeTripByDriver(token, { bytes, contentType: photo.type || "image/jpeg", price });
  if ("error" in r) return NextResponse.json(r, { status: 400 });
  return NextResponse.json(r);
}
