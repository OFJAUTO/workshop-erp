"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff, requireStaff } from "@/lib/auth";
import { greetingNameOf } from "@/lib/messages";
import { logQuoteEvent } from "@/lib/quote-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { aboveLimit, ABOVE_LIMIT_WORDS, cleanTintSpec, sameTintSpec, SHADES, tintChangeWords, tintSummary, type TintSpec } from "@/lib/tint";
import { tintLimitOf, tintPresetsOf, tintStageStarted } from "@/lib/tint-data";
import { formatPlate } from "@/lib/types";

/**
 * Section 11: the tint specification on a quotation. A draft saves quietly as it is tapped. Once the customer has
 * the quotation (sent, opened, approved), every change is written down old → new and comes back with the prepared
 * "updated tint choice" WhatsApp. Allowed until the tint stage starts; after that only the owner may correct it.
 */
export async function saveTintSpec(quotationId: string, raw: unknown): Promise<{ error?: string; ok?: boolean; logged?: boolean; message?: string | null; phone?: string | null; summary?: string | null }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "View only: nothing can be changed here." };
  const role = staff.role_id as RoleId;
  const isOwner = role === "owner";
  if (!(isOwner || can(role, "editQuotes"))) return { error: "Only an advisor or the owner can change the tint choice." };
  const spec = raw === null ? null : cleanTintSpec(raw);
  if (raw !== null && !spec) return { error: "That tint choice could not be read. Tap the windows again." };
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, job_id, kind, status, number, version, tint_spec, customer_id, vehicle_id, is_active").eq("id", quotationId).maybeSingle();
  if (!q || !q.is_active) return { error: "This quotation is no longer here." };
  if (q.status === "superseded" || q.status === "cancelled") return { error: "This version was replaced. Change the tint on the newest version." };
  const before = cleanTintSpec(q.tint_spec);
  if (sameTintSpec(before, spec)) return { ok: true };
  const stage = await tintStageStarted(q.job_id);
  if (stage.started && !isOwner) return { error: `The tint work has started (${stage.label}): the choice can no longer change. Ask the owner if it must.` };
  const { error } = await admin.from("quotations").update({ tint_spec: spec, updated_by: staff.id }).eq("id", q.id);
  if (error) return { error: error.message };

  const settings = await getSettings();
  const limit = tintLimitOf(settings);
  const quiet = q.status === "draft" || q.status === "pending_owner";
  let message: string | null = null;
  let phone: string | null = null;
  if (!quiet) {
    const over = aboveLimit(spec, limit);
    const note = `Tint choice changed by ${staff.display_name}${stage.started ? " (after the tint work started)" : ""}: ${tintChangeWords(before, spec)}${over.length ? ` · ${over.map((o) => `${o.label} ${o.shade}% darkness`).join(", ")}: ${ABOVE_LIMIT_WORDS}` : ""}`;
    await logQuoteEvent(q.id, q.job_id, staff.id, "tint_changed", note);
    const [{ data: customer }, { data: vehicle }] = await Promise.all([
      q.customer_id ? admin.from("customers").select("full_name, company_name, phone").eq("id", q.customer_id).maybeSingle() : Promise.resolve({ data: null }),
      q.vehicle_id ? admin.from("vehicles").select("plate_code, plate_number, plate_emirate, has_plate, vin, kind, variant, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", q.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const v = vehicle as unknown as ({ make: { name: string } | null; model: { name: string } | null } & Parameters<typeof formatPlate>[0]) | null;
    const template = String(settings.whatsapp_tint_update_template || "Hello [name], here is the updated tint choice for your [make model] ([plate]): [tint]. OFJ Automotive");
    message = template
      .replaceAll("[name]", greetingNameOf(customer as Parameters<typeof greetingNameOf>[0]))
      .replaceAll("[make model]", [v?.make?.name, v?.model?.name].filter(Boolean).join(" ") || "car")
      .replaceAll("[plate]", v ? formatPlate(v) : "")
      .replaceAll("[tint]", tintSummary(spec, limit) ?? "no window tint");
    phone = String((customer as { phone?: string | null } | null)?.phone ?? "").replace(/[^\d]/g, "") || null;
  }
  if (q.job_id) {
    revalidatePath(`/jobs/${q.job_id}`);
    revalidatePath(`/jobs/${q.job_id}/quote/${q.id}`);
    revalidatePath(`/bodyshop/${q.job_id}`);
  }
  if (q.kind === "estimate") revalidatePath(`/estimates/${q.id}`);
  return { ok: true, logged: !quiet, message, phone, summary: tintSummary(spec, limit) };
}

/** The owner's own one-tap preset, made from the box as it stands ("Save as a preset"). */
export async function addTintPreset(name: string, raw: unknown): Promise<{ error?: string; ok?: boolean; presets?: { name: string; spec: TintSpec }[] }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || staff.role_id !== "owner") return { error: "Only the owner can add presets." };
  const spec = cleanTintSpec(raw);
  const clean = String(name ?? "").trim().slice(0, 40);
  if (!clean) return { error: "Give the preset a name." };
  if (!spec) return { error: "Choose the windows first." };
  const settings = await getSettings();
  const list = tintPresetsOf(settings).filter((p) => p.name.toLowerCase() !== clean.toLowerCase());
  const next = [...list, { name: clean, spec }].slice(0, 12);
  await createAdminClient().from("settings").upsert({ key: "tint_presets", label: "Tint: one-tap presets", value: next, updated_by: staff.id }, { onConflict: "key" });
  revalidatePath("/settings/packages");
  return { ok: true, presets: next };
}

/** Settings > Packages > Window tint: the legal limit, the double-layer hours, the presets kept, the message. Owner only. */
export async function saveTintSettings(formData: FormData) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner" || staff.viewingAs) redirect(`/settings/packages?error=${encodeURIComponent("Owner only.")}`);
  const settings = await getSettings();
  const limit = Number(String(formData.get("tint_limit") ?? "").replace(",", "."));
  const shades = SHADES.filter((s): s is number => typeof s === "number");
  const hours = Number(String(formData.get("double_hours") ?? "").replace(",", "."));
  const keep = new Set(formData.getAll("keep_preset").map(String));
  const presets = tintPresetsOf(settings).filter((p) => keep.has(p.name));
  const template = String(formData.get("tint_template") ?? "").trim();
  const admin = createAdminClient();
  const upsert = async (key: string, label: string, value: unknown) => admin.from("settings").upsert({ key, label, value, updated_by: staff.id }, { onConflict: "key" });
  await upsert("tint_legal_max_darkness", "Tint: legal limit (darkness %, darker needs the customer's request)", shades.includes(limit) ? limit : Math.min(70, Math.max(5, Math.round(limit) || 50)));
  await upsert("tint_double_layer_hours", "Tint: extra installer hours per double-layer window", Number.isFinite(hours) && hours >= 0 ? Math.round(hours * 100) / 100 : 1);
  await upsert("tint_presets", "Tint: one-tap presets", presets);
  if (template) await upsert("whatsapp_tint_update_template", "WhatsApp: updated tint choice", template.slice(0, 1000));
  revalidatePath("/settings/packages");
  redirect(`/settings/packages?message=${encodeURIComponent("Tint settings saved.")}#tint`);
}
