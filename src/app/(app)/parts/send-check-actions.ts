"use server";

import { requireStaff } from "@/lib/auth";
import { logSendCheck, type SendKind } from "@/lib/send-check";

/** "YES, ALL CORRECT - SEND": the confirmation is logged (who, when, which flags were showing) before the send goes. */
export async function logSendCheckAction(kind: SendKind, refs: { jobId?: string | null; poId?: string | null; partIds?: string[] }, flags: { key: string; name: string; flags: string[] }[]): Promise<void> {
  const staff = await requireStaff();
  if (staff.viewingAs) return;
  await logSendCheck(kind, refs, flags, { id: staff.id });
}
