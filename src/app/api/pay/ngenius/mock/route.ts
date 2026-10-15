import { NextResponse, type NextRequest } from "next/server";
import { mockOrderGet, mockOrderSet, ngeniusEnv } from "@/lib/ngenius";
import { settleNgeniusOrder } from "@/lib/pay-now";

/**
 * The pretend payment page for local tests (NGENIUS_ENV=mock, never in production): shows the amount with
 * "Pay" and "Fail", then calls the same settle step the webhook and the return address use.
 */
function page(ref: string, amount: number) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mock payment page</title></head>
<body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px">
<h1 style="font-size:20px">Mock card payment</h1><p>Amount <strong>AED ${amount.toFixed(2)}</strong></p>
<form method="post"><input type="hidden" name="ref" value="${ref}">
<button name="outcome" value="paid" style="min-height:48px;width:100%;font-weight:700" data-mock-pay>Pay</button>
<button name="outcome" value="failed" style="min-height:44px;width:100%;margin-top:8px" data-mock-fail>Fail</button></form></body></html>`;
}

export async function GET(request: NextRequest) {
  if (ngeniusEnv() !== "mock") return NextResponse.json({ error: "Not available" }, { status: 404 });
  const ref = request.nextUrl.searchParams.get("ref") ?? "";
  const o = mockOrderGet(ref);
  if (!o) return new NextResponse("Unknown order", { status: 404 });
  return new NextResponse(page(ref, o.amountAed), { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function POST(request: NextRequest) {
  if (ngeniusEnv() !== "mock") return NextResponse.json({ error: "Not available" }, { status: 404 });
  const form = await request.formData();
  const ref = String(form.get("ref") ?? "");
  const outcome = String(form.get("outcome") ?? "");
  const o = mockOrderSet(ref, outcome === "paid" ? "CAPTURED" : "FAILED");
  if (!o) return new NextResponse("Unknown order", { status: 404 });
  // What the webhook would do a moment later.
  await settleNgeniusOrder(ref);
  return NextResponse.redirect(`${o.redirectUrl}${o.redirectUrl.includes("?") ? "&" : "?"}ref=${encodeURIComponent(ref)}`, { status: 303 });
}
