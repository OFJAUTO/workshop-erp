import { NextResponse, type NextRequest } from "next/server";
import { applyCustomerResponse } from "@/lib/quote-respond";
import { createAdminClient } from "@/lib/supabase/admin";

/** The customer's answer from the quotation page: Approved. (Declining is done by the advisor after talking to the customer.) */
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
  if (action !== "approve") return back("Please call or WhatsApp us if you do not wish to go ahead.");
  if (!agree) return back("Please tick the box to agree to the terms and conditions.");
  // Old PPF removal on the quotation: the customer must tick that they understand paint may lift; who and when is kept.
  const { data: lineRows } = await admin.from("quotation_lines").select("service_id").eq("quotation_id", q.id).eq("is_active", true).not("service_id", "is", null);
  const svcIds = Array.from(new Set((lineRows ?? []).map((l) => l.service_id as string)));
  const { data: svcs } = svcIds.length ? await admin.from("services").select("id, bodyshop_kind").in("id", svcIds) : { data: [] as { id: string; bodyshop_kind: string | null }[] };
  const needsRemovalAck = (svcs ?? []).some((s) => s.bodyshop_kind === "ppf_removal");
  const removalAck = form.get("removal_ack") === "on";
  if (needsRemovalAck && !removalAck) return back("Please tick that you understand old film removal may lift paint.");
  const res = await applyCustomerResponse(q.id, { approve: true, name, via: "customer", note });
  if (res.error) return back(res.error);
  if (needsRemovalAck) await admin.from("quotations").update({ removal_ack_at: new Date().toISOString(), removal_ack_name: name.slice(0, 120) }).eq("id", q.id);
  return back();
}
