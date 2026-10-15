import { NextResponse, type NextRequest } from "next/server";
import { settleNgeniusOrder } from "@/lib/pay-now";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The customer comes back from the payment page. The order is checked with the gateway (never the address bar),
 * recorded if paid, and the customer lands on their proforma page: "Paid, thank you" or "Payment not completed".
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const token = request.nextUrl.searchParams.get("t") ?? "";
  const ref = request.nextUrl.searchParams.get("ref");
  let reference = ref;
  if (!reference && token) {
    // N-Genius sends the customer back without our reference: the live order on this invoice is the one to check.
    const admin = createAdminClient();
    const { data: inv } = await admin.from("invoices").select("id, converted_to").eq("token", token).maybeSingle();
    if (inv) {
      const { data: link } = await admin.from("payment_links").select("order_reference").eq("invoice_id", inv.id).eq("provider", "ngenius").is("replaced_at", null).order("added_at", { ascending: false }).limit(1).maybeSingle();
      reference = link?.order_reference ?? null;
    }
  }
  const r = reference ? await settleNgeniusOrder(reference) : { paid: false };
  const target = `${origin}/proforma/${encodeURIComponent(token)}?${r.paid ? "paid=1" : "notpaid=1"}`;
  return NextResponse.redirect(target, { status: 303 });
}
