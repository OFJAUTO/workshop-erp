import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Records the customer's approval: name, time, and the exact terms shown. */
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const form = await request.formData();
  const name = String(form.get("approver_name") ?? "").trim();
  const agree = form.get("agree") === "on";
  const origin = request.nextUrl.origin;
  const back = (message?: string) =>
    NextResponse.redirect(`${origin}/approve/${token}${message ? `?error=${encodeURIComponent(message)}` : ""}`, { status: 303 });

  if (!agree) return back("Please tick the box to agree to the terms and conditions.");
  if (name.length < 2) return back("Please type your full name.");

  const admin = createAdminClient();
  const { data: req } = await admin.from("approval_requests").select("id, job_id, approved_at, status").eq("token", token).maybeSingle();
  if (!req) return back("This link is not valid.");
  if (req.approved_at) return back();

  const now = new Date().toISOString();
  const { error } = await admin
    .from("approval_requests")
    .update({ approved_at: now, approver_name: name, status: "approved", opened_at: now })
    .eq("id", req.id);
  if (error) return back("Something went wrong. Please try again.");

  const { data: job } = await admin.from("jobs").select("status, first_approval_at").eq("id", req.job_id).maybeSingle();
  const update: Record<string, unknown> = { first_approval_at: job?.first_approval_at ?? now };
  if (job?.status === "pending_approval") {
    update.status = "pending_inspection";
    update.stage = "inspection";
  }
  await admin.from("jobs").update(update).eq("id", req.job_id);
  await admin.from("job_events").insert({
    job_id: req.job_id,
    event_type: "approved",
    from_status: job?.status ?? null,
    to_status: job?.status === "pending_approval" ? "pending_inspection" : job?.status ?? null,
    note: `Job card approved by ${name} (customer link)`,
  });

  return back();
}
