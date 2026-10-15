import { NextResponse, type NextRequest } from "next/server";
import { settleNgeniusOrder } from "@/lib/pay-now";

/**
 * Network International calls this address when an order changes. The address carries our own secret (?key=…),
 * and nothing in the body is trusted: only the order reference is read, then the gateway is asked for the truth.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.NGENIUS_WEBHOOK_SECRET;
  if (!secret || request.nextUrl.searchParams.get("key") !== secret) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { order?: { reference?: string }; reference?: string };
  const reference = body.order?.reference ?? body.reference;
  if (!reference || typeof reference !== "string") return NextResponse.json({ ok: true, ignored: true });
  const r = await settleNgeniusOrder(reference);
  return NextResponse.json({ ok: true, paid: r.paid, already: r.already ?? false });
}
