"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/forms";
import { formValues } from "@/components/forms";
import { requirePermission } from "@/lib/auth";
import { blankToNull, normalisePhone } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const customerSchema = z
  .object({
    customer_type: z.enum(["individual", "company"], { message: "Choose individual or company." }),
    full_name: z.string().trim().min(2, "Enter the customer's name."),
    company_name: z.string().trim(),
    phone: z.string().trim().min(7, "Enter a phone number."),
    phone2: z.string().trim(),
    email: z.string().trim().toLowerCase(),
    area: z.string().trim(),
    trn: z.string().trim(),
    is_vip: z.boolean(),
    vip_note: z.string().trim(),
    notes: z.string().trim(),
  })
  .superRefine((d, ctx) => {
    if (d.customer_type === "company" && d.company_name.length < 2) {
      ctx.addIssue({ code: "custom", path: ["company_name"], message: "Enter the company name." });
    }
    if (d.email && !z.email().safeParse(d.email).success) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "That email does not look right." });
    }
    if (d.trn && !/^\d{15}$/.test(d.trn)) {
      ctx.addIssue({ code: "custom", path: ["trn"], message: "A TRN is 15 digits." });
    }
  });

function parse(formData: FormData) {
  return customerSchema.safeParse({
    customer_type: formData.get("customer_type"),
    full_name: formData.get("full_name"),
    company_name: formData.get("company_name") ?? "",
    phone: formData.get("phone"),
    phone2: formData.get("phone2") ?? "",
    email: formData.get("email") ?? "",
    area: formData.get("area") ?? "",
    trn: formData.get("trn") ?? "",
    is_vip: formData.get("is_vip") === "on",
    vip_note: formData.get("vip_note") ?? "",
    notes: formData.get("notes") ?? "",
  });
}

function toRow(d: z.infer<typeof customerSchema>) {
  return {
    customer_type: d.customer_type,
    full_name: d.full_name,
    company_name: d.customer_type === "company" ? d.company_name : null,
    phone: normalisePhone(d.phone),
    phone2: d.phone2 ? normalisePhone(d.phone2) : null,
    email: blankToNull(d.email),
    area: blankToNull(d.area),
    trn: blankToNull(d.trn),
    is_vip: d.is_vip,
    vip_note: d.is_vip ? blankToNull(d.vip_note) : null,
    notes: blankToNull(d.notes),
  };
}

export async function createCustomer(_state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("editCustomers");
  const values = formValues(formData);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };

  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").insert(toRow(parsed.data)).select("id").single();
  if (error || !data) return { error: error?.message ?? "Could not save.", values };

  revalidatePath("/customers");
  redirect(`/customers/${data.id}`);
}

export async function updateCustomer(id: string, _state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("editCustomers");
  const values = formValues(formData);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };

  const supabase = await createClient();
  const { error } = await supabase.from("customers").update(toRow(parsed.data)).eq("id", id);
  if (error) return { error: error.message, values };

  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}?message=` + encodeURIComponent("Saved."));
}

export async function setCustomerActive(id: string, active: boolean) {
  await requirePermission("editCustomers");
  const supabase = await createClient();
  const { error } = await supabase.from("customers").update({ is_active: active }).eq("id", id);
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  if (error) redirect(`/customers/${id}?error=` + encodeURIComponent(error.message));
  redirect(`/customers/${id}?message=` + encodeURIComponent(active ? "Customer re-activated." : "Customer archived."));
}

const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter the contact's name."),
  phone: z.string().trim().min(7, "Enter the contact's phone number."),
  relationship: z.string().trim(),
  can_approve: z.boolean(),
});

export async function addContact(customerId: string, _state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("editCustomers");
  const values = formValues(formData);
  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    relationship: formData.get("relationship") ?? "",
    can_approve: formData.get("can_approve") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };

  const supabase = await createClient();
  const { error } = await supabase.from("customer_contacts").insert({
    customer_id: customerId,
    name: parsed.data.name,
    phone: normalisePhone(parsed.data.phone),
    relationship: blankToNull(parsed.data.relationship),
    can_approve: parsed.data.can_approve,
  });
  if (error) return { error: error.message, values };

  revalidatePath(`/customers/${customerId}`);
  return { success: "Contact added." };
}

export async function setContactApproval(customerId: string, contactId: string, canApprove: boolean) {
  await requirePermission("editCustomers");
  const supabase = await createClient();
  await supabase.from("customer_contacts").update({ can_approve: canApprove }).eq("id", contactId);
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}

export async function setContactActive(customerId: string, contactId: string, active: boolean) {
  await requirePermission("editCustomers");
  const supabase = await createClient();
  await supabase.from("customer_contacts").update({ is_active: active }).eq("id", contactId);
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}
