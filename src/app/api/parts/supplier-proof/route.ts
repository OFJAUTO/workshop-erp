import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reopenZoho } from "@/lib/zoho-sync";

export const dynamic = "force-dynamic";

/**
 * The proof of a supplier payment (bank slip, card slip, signed receipt or cheque copy) added after the LPO was marked
 * paid. Accounts and the owner only. When the payment is already in Zoho, it runs once more to attach the proof.
 */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!(staff.role_id === "owner" || staff.role_id === "accounts")) return NextResponse.json({ error: "Only accounts or the owner upload the proof." }, { status: 403 });
  const form = await request.formData();
  const poId = String(form.get("po_id") ?? "");
  const file = form.get("file");
  if (!poId || !(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose the slip, receipt or cheque copy." }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "The file is over 15 MB. Take a smaller photo." }, { status: 400 });
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("id, number, supplier_paid_at").eq("id", poId).maybeSingle();
  if (!po) return NextResponse.json({ error: "LPO not found." }, { status: 404 });
  if (!po.supplier_paid_at) return NextResponse.json({ error: "Mark the LPO paid first." }, { status: 400 });
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `supplier-payments/${poId}/${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage.from("job-files").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: true });
  if (upErr) return NextResponse.json({ error: "Couldn't save the file – nothing was recorded. Try again." }, { status: 500 });
  await admin.from("purchase_orders").update({ supplier_paid_proof_path: path, supplier_paid_proof_at: new Date().toISOString(), supplier_paid_proof_by: staff.id, updated_by: staff.id }).eq("id", poId);
  await reopenZoho("billpayment", poId);
  return NextResponse.json({ ok: true, number: po.number });
}
