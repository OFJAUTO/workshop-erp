"use server";

import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * THE record of a customer message sent outside the documents' own send buttons (audit M13, 6 November 2026): the
 * 10-day check message, a pending charge's proforma message. A job's message goes on the job's history; a message
 * with no job (a pending charge) on the change log of its record. Who and when, never the message text.
 */
export async function logMessageSent(target: { jobId?: string | null; table?: "charge_entries"; recordId?: string | null }, what: string, method: "whatsapp" | "copy"): Promise<void> {
  const staff = await requireStaff();
  if (staff.viewingAs) return;
  const words = `${String(what).slice(0, 80)} sent by ${method === "whatsapp" ? "WhatsApp" : "copied message"} — ${staff.display_name}`;
  const admin = createAdminClient();
  if (target.jobId && UUID.test(target.jobId)) {
    await admin.from("job_events").insert({ job_id: target.jobId, event_type: "message_sent", note: words, created_by: staff.id });
    return;
  }
  if (target.table === "charge_entries" && target.recordId && UUID.test(target.recordId)) {
    await admin.from("audit_log").insert({ table_name: "charge_entries", record_id: target.recordId, action: "update", old_data: {}, new_data: { message_sent: words, by: staff.id, at: new Date().toISOString() }, changed_by: staff.id });
  }
}
