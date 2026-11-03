"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createPaymentReport, queryReport, withdrawReport } from "@/lib/payment-reports";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uuid";

/**
 * PAYMENT HAND-OVER (2 November 2026, section 3): the advisor's "Payment received – send to accounts", accounts' Query
 * and the advisor's Withdraw. Every rule lives in src/lib/payment-reports.ts; these only read the form, check the person
 * and refresh the pages that list the report.
 */

export type ReportState = { error?: string; ok?: boolean; ask?: "second"; askWords?: string; told?: string[]; /** The form's key was used for another payment: the window starts a new one. */ renewKey?: boolean; at?: number } | null;

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/invoice`);
  revalidatePath("/dashboard");
  revalidatePath("/invoices");
}

/** The advisor's report: amount, method, auth code or reference (optional), the slip photo (required, already sent), a note. */
export async function reportPaymentAction(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to send it.", at: Date.now() };
  const jobId = String(formData.get("job_id") ?? "");
  const r = await createPaymentReport(
    { id: staff.id, display_name: staff.display_name, role_id: staff.role_id },
    {
      id: String(formData.get("report_id") ?? ""),
      jobId,
      amount: formData.get("amount"),
      method: formData.get("method"),
      authCode: formData.get("auth_code"),
      reference: formData.get("reference"),
      note: formData.get("note"),
      replacesId: String(formData.get("replaces_id") ?? "") || null,
      confirmSecond: formData.get("confirm_second") === "1",
    },
    await getSettings(),
  );
  if (r.ok && isUuid(jobId)) refresh(jobId);
  return { ...r, at: Date.now() };
}

/** Accounts or the owner send the report back to the advisor with a comment. */
export async function queryPaymentReportAction(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to query it.", at: Date.now() };
  const reportId = String(formData.get("report_id") ?? "");
  const r = await queryReport(reportId, String(formData.get("note") ?? ""), { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  if (r.ok && isUuid(reportId)) {
    const { data } = await createAdminClient().from("payment_reports").select("job_id").eq("id", reportId).maybeSingle();
    if (data?.job_id) refresh(String(data.job_id));
  }
  return { ...r, at: Date.now() };
}

/** The advisor who sent it (or the owner) withdraws a report. */
export async function withdrawPaymentReportAction(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only.", at: Date.now() };
  const reportId = String(formData.get("report_id") ?? "");
  const r = await withdrawReport(reportId, String(formData.get("reason") ?? ""), { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  if (r.ok && isUuid(reportId)) {
    const { data } = await createAdminClient().from("payment_reports").select("job_id").eq("id", reportId).maybeSingle();
    if (data?.job_id) refresh(String(data.job_id));
  }
  return { ...r, at: Date.now() };
}
