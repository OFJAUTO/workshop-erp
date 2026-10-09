import { NextResponse, type NextRequest } from "next/server";
import { applyCustomerResponse, requestUrgentOnly } from "@/lib/quote-respond";
import { createAdminClient } from "@/lib/supabase/admin";

/** The customer's answer from the quotation page: approve everything, ask for urgent work only, or decline. */
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const form = await request.formData();
  const origin = request.nextUrl.origin;
  const back = (message?: string) => NextResponse.redirect(`${origin}/quote/${token}${message ? `?error=${encodeURIComponent(message)}` : ""}`, { status: 303 });
  const action = String(form.get("action") ?? "approve");
  const name = String(form.get("approver_name") ?? "").trim();
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  const agree = form.get("agree") === "on";

  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, status, valid_until, kind").eq("token", token).maybeSingle();
  if (!q) return back("This link is not valid.");
  if (!["sent", "opened"].includes(q.status)) return back();
  if (q.valid_until && Date.parse(q.valid_until) < Date.now()) return back("This quotation has expired. Please ask the workshop for a new one.");
  if (name.length < 2) return back("Please type your full name.");
  if (action === "approve" && !agree) return back("Please tick the box to agree to the terms and conditions.");

  const res = action === "urgent" ? await requestUrgentOnly(q.id, { name, note }) : await applyCustomerResponse(q.id, { approve: action === "approve", name, via: "customer" });
  if (res.error) return back(res.error);
  return back();
}
