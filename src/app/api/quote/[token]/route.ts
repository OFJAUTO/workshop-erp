import { NextResponse, type NextRequest } from "next/server";
import { normalisePhone } from "@/lib/format";
import { applyCustomerResponse } from "@/lib/quote-respond";
import { createAdminClient } from "@/lib/supabase/admin";

/** The customer's answer from the quotation page: approve the ticked lines, or decline everything. */
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const form = await request.formData();
  const origin = request.nextUrl.origin;
  const back = (message?: string) => NextResponse.redirect(`${origin}/quote/${token}${message ? `?error=${encodeURIComponent(message)}` : ""}`, { status: 303 });
  const action = String(form.get("action") ?? "approve");
  const name = String(form.get("approver_name") ?? "").trim();
  const phone = String(form.get("approver_phone") ?? "").trim();
  const agree = form.get("agree") === "on";

  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, status, valid_until, kind").eq("token", token).maybeSingle();
  if (!q) return back("This link is not valid.");
  if (!["sent", "opened"].includes(q.status)) return back();
  if (q.valid_until && Date.parse(q.valid_until) < Date.now()) return back("This quotation has expired. Please ask the workshop for a new one.");
  if (name.length < 2) return back("Please type your full name.");
  if (action === "approve" && !agree) return back("Please tick the box to agree to the terms and conditions.");

  const approved = Array.from(form.keys()).filter((k) => k.startsWith("line_")).map((k) => k.slice(5));
  if (action === "approve" && approved.length === 0) return back("Choose at least one line to approve, or use Decline all.");
  const res = await applyCustomerResponse(q.id, { approvedLineIds: action === "decline" ? [] : approved, declineAll: action === "decline", name, phone: phone ? normalisePhone(phone) : null, via: "customer" });
  if (res.error) return back(res.error);
  return back();
}
