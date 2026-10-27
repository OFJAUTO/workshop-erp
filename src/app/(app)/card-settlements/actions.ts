"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { recordSettlement } from "@/lib/card-settlements";
import { formValues, type FormState } from "@/lib/form-state";

const blank = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  return t ? t.slice(0, 200) : null;
};

export async function recordSettlementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("cardSettlements");
  const values = formValues(formData);
  if (staff.viewingAs) return { error: "You are viewing as someone else: switch back to record a settlement.", values };
  const receivedRaw = String(formData.get("received") ?? "").replace(/,/g, "").trim();
  const received = receivedRaw ? Number(receivedRaw) : null;
  const res = await recordSettlement(
    {
      method: String(formData.get("method") ?? ""),
      settledOn: String(formData.get("settled_on") ?? "").slice(0, 10),
      paymentIds: formData.getAll("ids").map(String),
      received: received !== null && Number.isFinite(received) ? received : null,
      statementRef: blank(formData.get("statement_ref")),
      note: blank(formData.get("note")),
      confirmed: formData.get("confirmed") === "1",
    },
    staff.id,
  );
  if (!res.ok) return { error: res.error, values: { ...values, ...(res.askAgain ? { ask: "1" } : {}) } };
  revalidatePath("/card-settlements");
  return { success: `${res.number} recorded: ${res.count} payment${res.count === 1 ? "" : "s"}, bank fee AED ${res.fee.toFixed(2)}. Each job now shows the actual fee, and Zoho gets the transfer and the bank charges.` };
}
