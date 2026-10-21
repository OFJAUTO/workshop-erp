"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";

/**
 * Section 2 (21 October): commissions are paid on the Commissions page only - cash with a printed,
 * signed voucher, transfers with their reference and slip. The monthly report's old one-tap "Mark
 * paid" would skip that proof, so it now opens the Commissions page with the row ready to tick.
 */
export async function markCommissionPaid(quotationId: string, formData: FormData) {
  void quotationId;
  void formData;
  const staff = await requireStaff();
  if (!(staff.role_id === "owner" || staff.role_id === "accounts") || staff.viewingAs) redirect("/dashboard");
  redirect(`/commissions?message=${encodeURIComponent("Commissions are paid here now: tick the rows, pick cash or transfer, and upload the signed voucher or slip.")}`);
}
