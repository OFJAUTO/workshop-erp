"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createMainLpo, orderSupplierLpo, setPartExpected } from "@/lib/lpo";
import { notifyStaff } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

function refresh(jobId: string | null, poId?: string | null) {
  revalidatePath("/parts");
  revalidatePath("/parts/orders");
  if (poId) revalidatePath(`/parts/orders/${poId}`);
  if (jobId) {
    revalidatePath(`/parts/${jobId}`);
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/my-jobs/${jobId}`);
  }
  revalidatePath("/dashboard");
}

const enc = encodeURIComponent;

/** The job's advisors: who gated the car in and who sent the approval link. */
async function advisorIds(jobId: string) {
  const admin = createAdminClient();
  const [{ data: job }, { data: appr }] = await Promise.all([admin.from("jobs").select("gated_in_by").eq("id", jobId).maybeSingle(), admin.from("approval_requests").select("sent_by").eq("job_id", jobId)]);
  return Array.from(new Set([job?.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}

/** Parts: one button after the customer's approval. The main LPO with every supplier goes to the owner or the head accountant. */
export async function sendLpoForApproval(jobId: string) {
  const staff = await requirePermission("managePurchaseOrders");
  const r = await createMainLpo(jobId, staff);
  refresh(jobId, r.poId ?? null);
  if (r.error) redirect(`/parts/${jobId}?error=${enc(r.error)}#lpo`);
  redirect(`/parts/${jobId}?message=${enc(`${r.number} sent for approval. After the one-tap approval, one LPO per supplier appears here with Copy, PDF and Ordered.`)}#lpo`);
}

/** "Ordered" on a supplier LPO: one tap; the arrival dates follow from the availability entered at pricing. */
export async function markSupplierOrdered(poId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const from = String(formData.get("from") ?? "");
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("id, job_id, supplier_name").eq("id", poId).maybeSingle();
  if (!po) redirect("/parts/orders");
  const back = from === "lpo" ? `/parts/orders/${poId}` : `/parts/${po.job_id}`;
  const r = await orderSupplierLpo(poId, staff);
  refresh(po.job_id, poId);
  if (r.error) redirect(`${back}?error=${enc(r.error)}`);
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", po.job_id).maybeSingle();
  await notifyStaff(await advisorIds(po.job_id), { type: "parts_arrived", title: `Parts ordered · ${job?.job_number ?? ""}`, body: `${r.number} from ${po.supplier_name}${r.latest ? `, expected by ${formatDate(r.latest)}` : ""}.`, jobId: po.job_id, href: `/jobs/${po.job_id}` });
  redirect(`${back}?message=${enc(`${r.number} marked ordered${r.latest ? `; all here by ${formatDate(r.latest)}` : "; set the dates with a tap when the supplier confirms"}.`)}`);
}

/** One part's arrival date changed with a tap. */
export async function setPartExpectedDate(partId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("job_id").eq("id", partId).maybeSingle();
  if (!p) redirect("/parts");
  const r = await setPartExpected(partId, String(formData.get("date") ?? "").trim(), staff);
  refresh(p.job_id);
  const from = String(formData.get("from") ?? "");
  const back = from.startsWith("/") ? from : `/parts/${p.job_id}`;
  redirect(`${back}?${r.error ? `error=${enc(r.error)}` : `message=${enc("Date saved.")}`}`);
}
