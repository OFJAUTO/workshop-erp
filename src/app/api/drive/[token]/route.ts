import { NextResponse, type NextRequest } from "next/server";
import { completeTripByDriver, markTripLoadedByDriver, type TripPhotoInput } from "@/lib/delivery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The driver's step: "Car loaded" (photo) or the final "Delivered" (photo and his price). 30 October 2026: the photo is
 * sent straight to storage first (prepare), so this request carries only its name - never the photo itself, which
 * Vercel refuses above 4.5 MB before our code runs (every phone photo of 5-12 MB was refused). A page opened before
 * the change still sends the photo in the request and works when it is small. The link is dead once used.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let step = "";
  let price = NaN;
  let photo: TripPhotoInput | null = null;
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { step?: string; path?: string; contentType?: string; price?: string | number } | null;
    if (!body?.path) return NextResponse.json({ error: "Take the photo first.", code: "photo" }, { status: 400 });
    step = String(body.step ?? "");
    price = Number(String(body.price ?? "").replace(",", "."));
    photo = { path: String(body.path), contentType: String(body.contentType ?? "image/jpeg") };
  } else {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "The photo did not come through. Try again.", code: "photo" }, { status: 400 });
    }
    const file = form.get("photo");
    if (!(file instanceof File)) return NextResponse.json({ error: "Take the photo first.", code: "photo" }, { status: 400 });
    step = String(form.get("step") ?? "");
    price = Number(String(form.get("price") ?? "").replace(",", "."));
    photo = { bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type || "image/jpeg" };
  }
  // Pick-ups have two steps: "Car loaded" (photo only) first, then "Delivered to OFJ" with the price.
  // A price always means the driver is finishing, whatever the step field says - driver-proof.
  const r = step === "loaded" && !(price > 0) ? await markTripLoadedByDriver(token, photo) : await completeTripByDriver(token, { ...photo, price });
  if ("error" in r) return NextResponse.json(r, { status: r.code === "link" ? 410 : r.code === "done" ? 409 : 400 });
  return NextResponse.json(r);
}
