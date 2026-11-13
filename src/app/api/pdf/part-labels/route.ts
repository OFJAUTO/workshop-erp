import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { partLabelsFor, sampleLabel } from "@/lib/part-labels";
import { renderPartLabelsPdf } from "@/lib/pdf/part-label-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { stickerSettings } from "@/lib/stickers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;
const ids = (raw: string | null) => (raw ?? "").split(",").map((x) => x.trim()).filter((x) => UUID.test(x));
const keys = (raw: string | null) => (raw ?? "").split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}-\d{1,3}$/i.test(x));

/**
 * The part labels as a PDF (6 November 2026, Section 8): `?job=<id>` every received part of a car, `&parts=a,b` some of
 * them, `?po=<id>` the parts of one LPO, `?today=1` everything received today, `&keys=<partId>-<n>,…` fewer labels, `?test=1` one sample with its outline.
 * Each page is exactly one label at the size from Settings > Stickers (50 × 25 mm), zero margins. Parts and the LPO
 * approvers (the people who receive and print).
 */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return new NextResponse("Please sign in.", { status: 401 });
  if (!can(staff.role_id as RoleId, "viewPurchaseOrders") && !can(staff.role_id as RoleId, "printStickers")) return new NextResponse("Not allowed.", { status: 403 });
  const sp = request.nextUrl.searchParams;
  const ss = stickerSettings(await getSettings());
  const size = { w: ss.partW || 50, h: ss.partH || 25 };
  if (sp.get("test") === "1") return pdfResponse(await renderPartLabelsPdf([sampleLabel()], size, { border: true }), `OFJ test label ${size.w}x${size.h}.pdf`);
  const job = UUID.test(sp.get("job") ?? "") ? sp.get("job") : null;
  const po = UUID.test(sp.get("po") ?? "") ? sp.get("po") : null;
  const labels = await partLabelsFor({ jobId: job, poId: po, partIds: ids(sp.getAll("parts").join(",")), keys: keys(sp.get("keys")), today: sp.get("today") === "1" }, staff.id);
  // 13 November 2026 (Section 2): never a 404 - nothing to print is said in plain words, with the way back.
  if (!labels.length) return new NextResponse('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>No labels to print</title><body style="font-family:Arial,sans-serif;padding:24px"><h1 style="font-size:20px">No labels to print yet</h1><p>Labels appear once a delivery is recorded. Nothing was received for this choice.</p><p><a href="javascript:history.back()">Back</a></p></body>', { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  return pdfResponse(await renderPartLabelsPdf(labels, size, { border: sp.get("border") === "1" }), `OFJ part labels ${labels[0].jobNumber}.pdf`);
}
