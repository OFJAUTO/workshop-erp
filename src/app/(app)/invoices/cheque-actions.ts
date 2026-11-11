"use server";

import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { chequeAlreadyWords } from "@/lib/cheque-cap";

/**
 * "Cheque 019383 is already recorded: …" while the cheque number is typed (11 November 2026, Section 5): the warning
 * before saving; the recorder itself enforces the cap. Owner and accounts only (they record payments).
 */
export async function chequeAlreadyAction(chequeNumber: string, bank: string | null): Promise<string | null> {
  const staff = await requireStaff();
  if (!["owner", "accounts"].includes(staff.role_id)) return null;
  const n = chequeNumber.trim();
  if (n.length < 3) return null;
  const { data } = await createAdminClient().from("payments").select("number, amount_aed, cheque_bank, cheque_status, job:jobs!payments_job_id_fkey(job_number)").eq("cheque_number", n).eq("is_active", true).in("status", ["recorded", "pending_owner"]).limit(20);
  const rows = ((data ?? []) as unknown as { number: string; amount_aed: number | string; cheque_bank: string | null; cheque_status: string | null; job: { job_number: string } | null }[]).filter((r) => !bank || !r.cheque_bank || r.cheque_bank.trim().toLowerCase() === bank.trim().toLowerCase());
  return chequeAlreadyWords(n, rows.map((r) => ({ number: r.number, amount: Number(r.amount_aed) || 0, jobNumber: r.job?.job_number ?? null, cleared: r.cheque_status === "cleared", chequeTotal: null })));
}
