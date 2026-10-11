import { NextResponse, type NextRequest } from "next/server";
import { openPaymentLink } from "@/lib/payment-links";

/** The customer confirmed Pay now: the link is recorded as opened and the customer's browser is sent to it. Only a tap on the button gets here; nothing else ever requests the address. */
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const origin = request.nextUrl.origin;
  const res = await openPaymentLink(token);
  if (res.error || !res.url) return NextResponse.redirect(`${origin}/invoice/${token}?error=${encodeURIComponent(res.error ?? "Could not open the payment link.")}`, { status: 303 });
  return NextResponse.redirect(res.url, { status: 303 });
}
