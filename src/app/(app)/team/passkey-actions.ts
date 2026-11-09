"use server";

import { RESET_CODE_MINUTES, requiredRolesOf } from "@/lib/passkey-rules";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAppError } from "@/lib/app-errors";
import { notifyStaff } from "@/lib/notifications";
import type { FormState } from "@/lib/form-state";
import { logSignInChange, passkeysReady } from "@/lib/passkey-server";

/**
 * The owner's sign-in controls (7 November 2026). Only the owner, as himself (never while viewing or acting as
 * someone), removes a phone or resets a person's passkeys; every change is logged and the person is told.
 */
async function ownerHimself() {
  const owner = await requirePermission("manageTeam");
  if (owner.viewingAs || owner.actingAs || owner.role_id !== "owner") return null;
  return owner;
}

const SAVE_FAILED = "Couldn't save – nothing was changed. Try again.";

export async function removePasskey(staffId: string, passkeyId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await ownerHimself();
  if (!owner) return { error: "Only the owner, as himself, can remove a phone." };
  if (!(await passkeysReady())) return { error: "Passkeys are not switched on yet." };
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "Say why (for example: phone lost).", values: { reason } };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("staff_passkeys")
    .update({ removed_at: new Date().toISOString(), removed_by: owner.id, removed_reason: reason, updated_by: owner.id })
    .eq("id", passkeyId)
    .eq("staff_id", staffId)
    .is("removed_at", null)
    .select("id, name");
  if (error) {
    await logAppError("team.removePasskey", error, { staffId });
    return { error: SAVE_FAILED };
  }
  if (!data?.length) return { error: "That phone was already removed." };
  const name = data[0].name as string;
  await logSignInChange({ staffId, kind: "passkey_removed", detail: `${name} · ${reason}`, passkeyId, by: owner.id });
  await notifyStaff([staffId], {
    type: "passkey_removed",
    title: `${owner.display_name} removed a phone from your sign-in: ${name}`,
    body: `Reason: ${reason}. Sign in with your password; you will be asked to set up a phone if none is left.`,
    href: "/account/sign-in",
  });
  revalidatePath(`/team/${staffId}`);
  revalidatePath("/team/sign-ins");
  return { success: `Removed: ${name}. It can no longer sign in.` };
}

export async function resetPasskeys(staffId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await ownerHimself();
  if (!owner) return { error: "Only the owner, as himself, can reset passkeys." };
  if (!(await passkeysReady())) return { error: "Passkeys are not switched on yet." };
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "Say why (for example: new phone).", values: { reason } };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("staff_passkeys")
    .update({ removed_at: new Date().toISOString(), removed_by: owner.id, removed_reason: `Reset: ${reason}`, updated_by: owner.id })
    .eq("staff_id", staffId)
    .is("removed_at", null)
    .select("id");
  if (error) {
    await logAppError("team.resetPasskeys", error, { staffId });
    return { error: SAVE_FAILED };
  }
  const n = data?.length ?? 0;
  if (n === 0) return { error: "This person has no phone set up." };
  await logSignInChange({ staffId, kind: "passkeys_reset", detail: `${n} phone${n === 1 ? "" : "s"} removed · ${reason}`, by: owner.id });
  await notifyStaff([staffId], {
    type: "passkey_removed",
    title: `${owner.display_name} reset your sign-in phones`,
    body: `Reason: ${reason}. Sign in with your password, then set up your phone again.`,
    href: "/account/sign-in",
  });
  revalidatePath(`/team/${staffId}`);
  revalidatePath("/team/sign-ins");
  return { success: `Reset: ${n} phone${n === 1 ? "" : "s"} removed. At the next sign-in with the password the person sets up a phone again.` };
}

/** "Require passkey" per role (9 November 2026): off until the owner turns it on; every change is logged. */
export async function setRequiredRoles(_state: FormState, formData: FormData): Promise<FormState> {
  const owner = await ownerHimself();
  if (!owner) return { error: "Only the owner, as himself, can change this." };
  if (!(await passkeysReady())) return { error: "Passkeys are not switched on yet." };
  const roles = requiredRolesOf(formData.getAll("required").map(String));
  const { error } = await createAdminClient()
    .from("settings")
    .upsert({ key: "passkeys_required_roles", value: roles, label: "Require passkey for these roles (people with a passkey cannot use the password)", updated_by: owner.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) {
    await logAppError("team.setRequiredRoles", error);
    return { error: SAVE_FAILED };
  }
  await logSignInChange({ staffId: null, kind: "require_passkey", detail: roles.length ? roles.join(", ") : "off for every role", by: owner.id });
  revalidatePath("/team/sign-ins");
  return { success: roles.length ? `Passkey required for: ${roles.join(", ")}. People there with a passkey can no longer use the password; the others are asked to set one up.` : "Passkey is not required for any role." };
}

export async function setPasskeyRollout(_state: FormState, formData: FormData): Promise<FormState> {
  const owner = await ownerHimself();
  if (!owner) return { error: "Only the owner, as himself, can switch passkeys on." };
  if (!(await passkeysReady())) return { error: "Passkeys are not switched on yet." };
  const mode = String(formData.get("mode") ?? "");
  if (mode !== "owner" && mode !== "all") return { error: "Choose who uses passkeys." };
  const { error } = await createAdminClient()
    .from("settings")
    .upsert({ key: "passkeys_rollout", value: mode, label: "Passkeys switched on for (owner = only the owner, all = every passkey role)", updated_by: owner.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) {
    await logAppError("team.setPasskeyRollout", error);
    return { error: SAVE_FAILED };
  }
  await logSignInChange({ staffId: null, kind: "rollout", detail: mode === "all" ? "Everyone in the passkey roles" : "Only the owner", by: owner.id });
  revalidatePath("/team/sign-ins");
  return { success: mode === "all" ? "Passkeys are on for everyone in the passkey roles. Each person is asked to set up a phone at their next sign-in." : "Passkeys are on for you only." };
}

/**
 * Lost phone (9 November 2026): ONLY the owner gives a person a one-time sign-in code - 15 minutes, single use,
 * logged. The person signs in with it on the login page ("Lost your phone?") and is taken straight to setting up a
 * new passkey. Only the code's hash is kept. There is no self-service reset that skips the owner.
 */
export async function giveResetCode(staffId: string): Promise<{ error?: string; code?: string; until?: string }> {
  const owner = await ownerHimself();
  if (!owner) return { error: "Only the owner, as himself, gives a one-time sign-in code." };
  if (!(await passkeysReady())) return { error: "Passkeys are not switched on yet." };
  const { randomInt, createHash } = await import("node:crypto");
  const code = String(randomInt(10_000_000, 99_999_999));
  const hash = createHash("sha256").update(`${staffId}:${code}`).digest("hex");
  const until = new Date(Date.now() + RESET_CODE_MINUTES * 60_000);
  const admin = createAdminClient();
  // An earlier unused code of this person stops working: one code at a time.
  await admin.from("passkey_challenges").update({ used_at: new Date().toISOString() }).eq("purpose", "reset").eq("staff_id", staffId).is("used_at", null);
  const { error } = await admin.from("passkey_challenges").insert({ purpose: "reset", challenge: hash, staff_id: staffId, expires_at: until.toISOString() });
  if (error) {
    if (/purpose_check|check constraint/i.test(error.message)) return { error: "The one-time code switches on with the database update of 9 November (WAITING FOR APPLY). Until then: Remove the lost phone, and the person signs in with the password and sets up the new phone." };
    await logAppError("team.giveResetCode", error, { staffId: owner.id });
    return { error: SAVE_FAILED };
  }
  await logSignInChange({ staffId, kind: "one_time_code", detail: `valid until ${until.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" })}`, by: owner.id });
  revalidatePath(`/team/${staffId}`);
  return { code: `${code.slice(0, 4)} ${code.slice(4)}`, until: until.toISOString() };
}
