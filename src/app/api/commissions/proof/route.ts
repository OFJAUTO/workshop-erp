import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Section 2 (21 October): the signed voucher photo or the bank slip lands on the commission payment.
 * Accounts and the owner only. Until this is done the payment reads "Paid - proof missing" everywhere.
 */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!(staff.role_id === "owner" || staff.role_id === "accounts")) return NextResponse.json({ error: "Only accounts or the owner upload the proof." }, { status: 403 });
  const form = await request.formData();
  const paymentId = String(form.get("payment_id") ?? "");
  const file = form.get("file");
  if (!paymentId || !(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose the signed voucher photo or the bank slip." }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "The file is over 15 MB. Take a smaller photo." }, { status: 400 });
  const admin = createAdminClient();
  const { data: pay } = await admin.from("commission_payments").select("id, number").eq("id", paymentId).maybeSingle();
  if (!pay) return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `commission-payments/${paymentId}/${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage.from("job-files").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  await admin.from("commission_payments").update({ proof_path: path, proof_uploaded_at: new Date().toISOString(), proof_uploaded_by: staff.id, updated_by: staff.id }).eq("id", paymentId);
  return NextResponse.json({ ok: true, number: pay.number });
}
