"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { hashPin, PIN_PATTERN } from "@/lib/pin";
import { ALL_ROLES } from "@/lib/roles";
import { getSiteUrl } from "@/lib/site";
import { issueSetupToken } from "@/lib/setup-links";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { blankToNull, normalisePhone } from "@/lib/format";

const PIN_EMAIL_DOMAIN = process.env.PIN_EMAIL_DOMAIN ?? "tablet.ofjauto.com";

const staffSchema = z
  .object({
    full_name: z.string().trim().min(2, "Enter the full name."),
    display_name: z.string().trim().min(1, "Enter the short name shown on screens."),
    role_id: z.enum(ALL_ROLES as [string, ...string[]], { message: "Choose a role." }),
    department_id: z.enum(["mechanical", "bodyshop", "paint", "ppf_tint", "office"], { message: "Choose a department." }),
    employee_number: z.string().trim().optional(),
    login_type: z.enum(["password", "pin"]).optional(),
    email: z.string().trim().toLowerCase().optional(),
    phone: z.string().trim().optional(),
    pin: z.string().trim().optional(),
    is_head_accountant: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (d.login_type === "password" && !z.email().safeParse(d.email ?? "").success) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "A valid email is needed for password login." });
    }
    if (d.email && !z.email().safeParse(d.email).success) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "That email does not look right." });
    }
  });

function firstIssue(result: { success: false; error: z.ZodError }) {
  return result.error.issues[0]?.message ?? "Check the form.";
}

function parseStaff(formData: FormData) {
  return staffSchema.safeParse({
    full_name: formData.get("full_name"),
    display_name: formData.get("display_name"),
    role_id: formData.get("role_id"),
    department_id: formData.get("department_id"),
    employee_number: formData.get("employee_number") ?? "",
    login_type: formData.get("login_type") || undefined,
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    pin: formData.get("pin") ?? "",
    is_head_accountant: formData.get("is_head_accountant") === "on",
  });
}

export async function createStaff(_state: FormState, formData: FormData): Promise<FormState> {
  const owner = await requirePermission("manageTeam");
  const values = formValues(formData);
  const parsed = parseStaff(formData);
  if (!parsed.success) return { error: firstIssue(parsed), values };
  const d = parsed.data;

  if (!d.login_type) return { error: "Choose how this person logs in.", values };
  if (d.login_type === "pin" && !PIN_PATTERN.test(d.pin ?? "")) {
    return { error: "Tablet login needs a 4-digit PIN.", values };
  }

  const admin = createAdminClient();
  const loginEmail =
    d.login_type === "password" ? d.email! : `pin-${randomBytes(6).toString("hex")}@${PIN_EMAIL_DOMAIN}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: loginEmail,
    email_confirm: true,
    user_metadata: { full_name: d.full_name },
  });
  if (createError || !created.user) {
    const msg = createError?.message ?? "Could not create the login.";
    return { error: msg.includes("already") ? "A login with that email already exists." : msg, values };
  }
  const id = created.user.id;

  const supabase = await createClient();
  const { error: staffError } = await supabase.from("staff").insert({
    id,
    full_name: d.full_name,
    display_name: d.display_name,
    role_id: d.role_id,
    department_id: d.department_id,
    employee_number: blankToNull(d.employee_number),
    login_type: d.login_type,
    is_head_accountant: d.is_head_accountant,
    created_by: owner.id,
    updated_by: owner.id,
  });
  if (staffError) {
    await admin.auth.admin.deleteUser(id);
    const msg = staffError.message.includes("employee_number")
      ? "That employee number is already used."
      : staffError.message;
    return { error: msg, values };
  }

  const { error: privError } = await supabase.from("staff_private").insert({
    staff_id: id,
    email: blankToNull(d.email),
    phone: d.phone ? normalisePhone(d.phone) : null,
    pin_hash: d.login_type === "pin" ? hashPin(d.pin!) : null,
    pin_updated_at: d.login_type === "pin" ? new Date().toISOString() : null,
    updated_by: owner.id,
  });
  if (privError) return { error: privError.message, values };

  revalidatePath("/team");
  if (d.login_type === "password") {
    redirect(`/team/${id}?setup=1`);
  }
  redirect(`/team/${id}`);
}

export async function updateStaff(id: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await requirePermission("manageTeam");
  const values = formValues(formData);
  const parsed = parseStaff(formData);
  if (!parsed.success) return { error: firstIssue(parsed), values };
  const d = parsed.data;

  if (id === owner.id && d.role_id !== "owner") {
    return { error: "You cannot remove the owner role from your own account.", values };
  }

  const supabase = await createClient();
  const { data: current } = await supabase.from("staff").select("login_type").eq("id", id).maybeSingle();
  if (!current) return { error: "Staff member not found.", values };

  const { error } = await supabase
    .from("staff")
    .update({
      full_name: d.full_name,
      display_name: d.display_name,
      role_id: d.role_id,
      department_id: d.department_id,
      employee_number: blankToNull(d.employee_number),
      is_head_accountant: d.is_head_accountant,
    })
    .eq("id", id);
  if (error) {
    return {
      error: error.message.includes("employee_number") ? "That employee number is already used." : error.message,
      values,
    };
  }

  const { error: privError } = await supabase
    .from("staff_private")
    .update({ email: blankToNull(d.email), phone: d.phone ? normalisePhone(d.phone) : null })
    .eq("staff_id", id);
  if (privError) return { error: privError.message, values };

  if (current.login_type === "password" && d.email) {
    const admin = createAdminClient();
    const { data: u } = await admin.auth.admin.getUserById(id);
    if (u.user && u.user.email?.toLowerCase() !== d.email) {
      const { error: emailError } = await admin.auth.admin.updateUserById(id, { email: d.email, email_confirm: true });
      if (emailError) return { error: "Saved, but the login email could not be changed: " + emailError.message, values };
    }
  }

  revalidatePath("/team");
  revalidatePath(`/team/${id}`);
  return { success: "Saved.", values };
}

export async function setStaffActive(id: string, active: boolean) {
  const owner = await requirePermission("manageTeam");
  if (id === owner.id) redirect(`/team/${id}?error=` + encodeURIComponent("You cannot disable your own account."));

  const supabase = await createClient();
  const { error } = await supabase
    .from("staff")
    .update({ is_active: active, disabled_at: active ? null : new Date().toISOString() })
    .eq("id", id);
  if (error) redirect(`/team/${id}?error=` + encodeURIComponent(error.message));

  // Disabled people are also blocked at the login level so open sessions end.
  const admin = createAdminClient();
  await admin.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });

  revalidatePath("/team");
  revalidatePath(`/team/${id}`);
  redirect(`/team/${id}?message=` + encodeURIComponent(active ? "Account enabled." : "Account disabled."));
}

export async function resetPin(id: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await requirePermission("manageTeam");
  const pin = String(formData.get("pin") ?? "").trim();
  if (!PIN_PATTERN.test(pin)) return { error: "The PIN must be exactly 4 digits." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("staff_private")
    .update({
      pin_hash: hashPin(pin),
      pin_failed_attempts: 0,
      pin_locked_until: null,
      pin_updated_at: new Date().toISOString(),
      updated_by: owner.id,
    })
    .eq("staff_id", id);
  if (error) return { error: error.message };

  revalidatePath(`/team/${id}`);
  return { success: "New PIN saved." };
}

/** Makes a 24-hour setup link the person opens to choose a password. Opening it changes nothing; it is used up when the password is saved. */
export async function createSetupLink(id: string) {
  const owner = await requirePermission("manageTeam");
  const admin = createAdminClient();
  const { data: u } = await admin.auth.admin.getUserById(id);
  if (!u.user?.email) redirect(`/team/${id}?error=` + encodeURIComponent("No login email on this account."));

  let token: string;
  try {
    token = await issueSetupToken(id, owner.id);
  } catch {
    redirect(`/team/${id}?error=` + encodeURIComponent("Could not create the link."));
  }
  const site = await getSiteUrl();
  redirect(`/team/${id}?link=${encodeURIComponent(`${site}/auth/setup/${token}`)}`);
}

export async function uploadStaffPhoto(id: string, _state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("manageTeam");
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo first." };
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { error: "Use a JPG, PNG or WebP photo." };
  if (file.size > 5 * 1024 * 1024) return { error: "The photo must be under 5 MB." };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${id}/${Date.now()}.${ext}`;
  const supabase = await createClient();
  const { error: upError } = await supabase.storage
    .from("staff-photos")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upError) return { error: "Upload failed: " + upError.message };

  const { error } = await supabase.from("staff").update({ photo_path: path }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/team/${id}`);
  revalidatePath("/team");
  return { success: "Photo updated." };
}

export async function setDeviceActive(id: string, active: boolean) {
  await requirePermission("manageTablets");
  const supabase = await createClient();
  const { error } = await supabase.from("devices").update({ is_active: active }).eq("id", id);
  revalidatePath("/team/tablets");
  if (error) redirect("/team/tablets?error=" + encodeURIComponent(error.message));
  redirect("/team/tablets");
}
