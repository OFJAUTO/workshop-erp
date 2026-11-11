"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbWords } from "@/lib/app-errors";
import { blankToNull } from "@/lib/format";
import { HR_BUCKET, ensureHrPerson, hrActor, logHr } from "@/lib/hr";
import { kindOf } from "@/lib/hr-rules";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * HR actions (11 November 2026, Section 15): every one checks the person again (owner or head accountant, phone
 * sign-in set up, not viewing as someone) and logs what it did. Nothing is ever deleted.
 */
const back = (id: string | null, words: string, ok: boolean): never => redirect(`/team/hr${id ? `/${id}` : ""}?${ok ? "message" : "error"}=${encodeURIComponent(words)}`);
const day = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const text = (v: FormDataEntryValue | null, max = 120) => blankToNull(v)?.slice(0, max) ?? null;

/** Open a staff member's HR file (made the first time). */
export async function openStaffFile(staffId: string) {
  const by = await hrActor();
  if (!by) return back(null, "HR is for the owner and the head accountant with a phone sign-in.", false);
  const id = await ensureHrPerson(staffId, by.id);
  if (!id) return back(null, "That person is not on the Team page.", false);
  redirect(`/team/hr/${id}`);
}

/** A person with no ERP login (a cleaner, a driver). */
export async function addPersonWithoutLogin(formData: FormData) {
  const by = await hrActor();
  if (!by) return back(null, "HR is for the owner and the head accountant with a phone sign-in.", false);
  const name = text(formData.get("passport_name"), 120);
  if (!name || name.length < 3) return back(null, "Type the name as on the passport.", false);
  const { data, error } = await createAdminClient().from("hr_people").insert({ passport_name: name, role_title: text(formData.get("role_title")), department: text(formData.get("department")), created_by: by.id, updated_by: by.id }).select("id").single();
  if (error) return back(null, dbWords(error, "hr/add"), false);
  await logHr(by.id, "created", { personId: data.id as string, detail: "Person with no ERP login added" });
  redirect(`/team/hr/${data.id}?message=${encodeURIComponent("Added. Fill in the details and upload the documents.")}`);
}

export async function savePerson(id: string, formData: FormData) {
  const by = await hrActor();
  if (!by) return back(id, "HR is for the owner and the head accountant with a phone sign-in.", false);
  const name = text(formData.get("passport_name"), 120);
  if (!name || name.length < 3) return back(id, "Type the name as on the passport.", false);
  const patch = {
    passport_name: name,
    role_title: text(formData.get("role_title")),
    department: text(formData.get("department")),
    joining_date: day(formData.get("joining_date")),
    phone: text(formData.get("phone"), 30),
    emergency_name: text(formData.get("emergency_name")),
    emergency_phone: text(formData.get("emergency_phone"), 30),
    contract_end: day(formData.get("contract_end")),
    probation_end: day(formData.get("probation_end")),
    updated_by: by.id,
  };
  const { error } = await createAdminClient().from("hr_people").update(patch).eq("id", id).eq("is_active", true);
  if (error) return back(id, dbWords(error, "hr/save"), false);
  await logHr(by.id, "edited", { personId: id, detail: "Details saved" });
  revalidatePath(`/team/hr/${id}`);
  return back(id, "Saved.", true);
}

/** A document with its number and expiry; a new one of the same kind replaces the old (the old is kept, marked replaced). */
export async function uploadHrDocument(id: string, formData: FormData) {
  const by = await hrActor();
  if (!by) return back(id, "HR is for the owner and the head accountant with a phone sign-in.", false);
  const kind = String(formData.get("kind") ?? "");
  const k = kindOf(kind);
  if (!k) return back(id, "Pick which document it is.", false);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return back(id, "Pick the file (a photo or a PDF).", false);
  if (file.size > 4 * 1024 * 1024) return back(id, "The file is over 4 MB: take the photo again or save the PDF smaller.", false);
  const type = file.type || "application/octet-stream";
  if (!(type === "application/pdf" || type.startsWith("image/"))) return back(id, "Only a photo or a PDF.", false);
  const expires = day(formData.get("expires_on"));
  if (k.warnDays && !expires) return back(id, `Type the ${k.label} expiry date.`, false);
  const admin = createAdminClient();
  const path = `${id}/${kind}/${randomUUID()}`;
  const up = await admin.storage.from(HR_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: type, upsert: false });
  if (up.error) return back(id, "Couldn't save the file – nothing was recorded. Try again.", false);
  const now = new Date().toISOString();
  await admin.from("hr_documents").update({ replaced_at: now, updated_by: by.id }).eq("person_id", id).eq("kind", kind).eq("is_active", true).is("replaced_at", null);
  const { data, error } = await admin.from("hr_documents").insert({ person_id: id, kind, doc_number: k.numbered ? text(formData.get("doc_number"), 40) : null, expires_on: expires, storage_path: path, file_name: file.name.slice(0, 120), content_type: type, created_by: by.id, updated_by: by.id }).select("id").single();
  if (error) return back(id, dbWords(error, "hr/upload"), false);
  await logHr(by.id, "uploaded", { personId: id, documentId: data.id as string, detail: `${k.label}${expires ? ` · expires ${expires}` : ""}` });
  revalidatePath(`/team/hr/${id}`);
  return back(id, `${k.label} saved.`, true);
}

/** Tapping a masked number shows it; the tap is logged. */
export async function revealHrNumber(documentId: string): Promise<{ number?: string; error?: string }> {
  const by = await hrActor();
  if (!by) return { error: "Not allowed." };
  const { data } = await createAdminClient().from("hr_documents").select("person_id, kind, doc_number").eq("id", documentId).eq("is_active", true).maybeSingle();
  if (!data) return { error: "Not found." };
  await logHr(by.id, "number_shown", { personId: data.person_id as string, documentId, detail: kindOf(data.kind as string)?.label ?? null });
  return { number: (data.doc_number as string | null) ?? "" };
}

/**
 * "Left": the ERP login is switched off (open sessions end), the file is archived, nothing is deleted. A reason is
 * required. The owner's own file cannot be marked left.
 */
export async function markPersonLeft(id: string, formData: FormData) {
  const by = await hrActor();
  if (!by) return back(id, "HR is for the owner and the head accountant with a phone sign-in.", false);
  const reason = text(formData.get("reason"), 300);
  if (!reason || reason.length < 5) return back(id, "Say why they left (at least a few words).", false);
  const admin = createAdminClient();
  const { data: p } = await admin.from("hr_people").select("staff_id, status").eq("id", id).maybeSingle();
  if (!p) return back(null, "Not found.", false);
  if (p.staff_id && p.staff_id === by.id) return back(id, "You cannot mark your own file as left.", false);
  if (p.staff_id) {
    const { data: s } = await admin.from("staff").select("role_id").eq("id", p.staff_id).maybeSingle();
    if (s?.role_id === "owner") return back(id, "The owner's file cannot be marked as left.", false);
  }
  const now = new Date().toISOString();
  const { error } = await admin.from("hr_people").update({ status: "left", left_at: now, left_reason: reason, left_by: by.id, updated_by: by.id }).eq("id", id);
  if (error) return back(id, dbWords(error, "hr/left"), false);
  await admin.from("hr_documents").update({ archived_at: now, updated_by: by.id }).eq("person_id", id).eq("is_active", true).is("archived_at", null);
  if (p.staff_id) {
    await admin.from("staff").update({ is_active: false, disabled_at: now }).eq("id", p.staff_id);
    await admin.auth.admin.updateUserById(p.staff_id as string, { ban_duration: "876000h" }).catch(() => null);
  }
  await logHr(by.id, "left", { personId: id, detail: reason });
  revalidatePath("/team/hr");
  return back(id, p.staff_id ? "Marked as left: their ERP sign-in is switched off and the file is archived." : "Marked as left: the file is archived.", true);
}
