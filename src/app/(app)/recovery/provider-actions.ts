"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { addRecoveryProvider, removeRecoveryProvider, type RecoveryProvider } from "@/lib/recovery-providers";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";

/** "+ Add new" in THE recovery company picker (30 October 2026, section 3.5): name and phone, saved for everyone. */
export async function addRecoveryProviderAction(name: string, phone: string): Promise<{ error?: string; provider?: RecoveryProvider }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View only." };
  const role = staff.role_id as RoleId;
  if (!can(role, "editQuotes") && !can(role, "gateOut")) return { error: "Only the owner, the advisors and accounts add recovery companies." };
  const r = await addRecoveryProvider(name, phone, staff.id);
  if (r.provider) revalidatePath("/recovery");
  return r;
}

/** The owner removes a saved name (a typing mistake such as "YGHUHGHU"). */
export async function removeRecoveryProviderAction(name: string): Promise<{ error?: string; ok?: boolean }> {
  const staff = await requireStaff();
  if (staff.role_id !== "owner" || staff.viewingAs) return { error: "Only the owner tidies the list." };
  await removeRecoveryProvider(name, await getSettings(), staff.id);
  revalidatePath("/recovery");
  return { ok: true };
}
