"use server";

import { invoicesForLock, loadQuoteLock, refuseIfLocked } from "@/lib/quote-lock-server";
import { jobAdvisorIds as advisorsInCharge } from "@/lib/notifications";
import { liveInvoicesOf } from "@/lib/quote-lock";
import { dropParts } from "@/lib/drop-parts";
import { createChargeInvoice } from "@/lib/invoice-flow";
import { COPY_FIELDS, askOwnerForRevision, createNextVersion, missingPricedParts, syncMissingParts } from "@/lib/quote-versions";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentStaff, requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { loadInspection } from "@/lib/inspection-data";
import { TYRE_POSITIONS } from "@/lib/inspection";
import { notifyManagers,notifyRoles, notifyStaff } from "@/lib/notifications";
import { LINE_SELECT, PART_SELECT, SERVICE_SELECT, ensurePartRequests, labourRateFor, loadQuotation, logQuoteEvent, minMarkupFor, quoteToken, refreshQuoteTotals, toLine, toPart, loadPartsWait, loadQuoteChecks, parentLineFor } from "@/lib/quote-data";
import { applyCustomerResponse } from "@/lib/quote-respond";
import { aed, isUnchosen, marginToneOf, ownerApprovalReasons, quoteTotals, recoveryTitle, round2, sendBlockers, type QuoteLine, blockOf } from "@/lib/quotes";
import { shortFor } from "@/lib/short-links";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { formatPlate } from "@/lib/types";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

function refresh(jobId: string | null, quotationId?: string) {
  if (jobId) {
    revalidatePath(`/jobs/${jobId}`);
    if (quotationId) revalidatePath(`/jobs/${jobId}/quote/${quotationId}`);
  }
  if (quotationId) revalidatePath(`/estimates/${quotationId}`);
  revalidatePath("/dashboard");
  revalidatePath("/estimates");
  revalidatePath("/parts");
}

/** The owner, or an advisor who is this job's advisor (or made the estimate). */
/** Who may work on a quotation: the owner and any advisor (the car keeps its own advisor; he is told when someone else changes or sends it). */
async function mayEdit(jobId: string | null, createdBy: string | null) {
  void jobId;
  void createdBy;
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return null;
  const role = staff.role_id as RoleId;
  if (role === "owner" || can(role, "editQuotes")) return staff;
  return null;
}

/** Part lines for every listed part on the job that is not yet on the quotation. */
async function syncPartLines(quotationId: string, jobId: string, by: string, minMarkup: number) {
  const admin = createAdminClient();
  const [{ data: parts }, { data: lines }] = await Promise.all([
    admin.from("part_items").select(PART_SELECT).eq("job_id", jobId).eq("is_active", true).neq("confirm_status", "rejected").eq("order_status", "none").order("created_at"),
    admin.from("quotation_lines").select("id, part_item_id, position").eq("quotation_id", quotationId).eq("is_active", true),
  ]);
  const have = new Set((lines ?? []).map((l) => l.part_item_id).filter(Boolean));
  let position = (lines ?? []).reduce((m, l) => Math.max(m, Number(l.position) || 0), -1) + 1;
  const { data: reqs } = await admin.from("part_requests").select("id, label, source_type, source_key").eq("job_id", jobId);
  const labelOf = new Map((reqs ?? []).map((r) => [r.id, r.label]));
  const reqOf = new Map((reqs ?? []).map((r) => [r.id, r]));
  const rows: Record<string, unknown>[] = [];
  for (const p of ((parts ?? []) as Record<string, unknown>[]).map(toPart).filter((p) => !have.has(p.id))) rows.push({
    parent_line_id: await parentLineFor(quotationId, p.part_request_id ? (reqOf.get(p.part_request_id) ?? null) : null),
    quotation_id: quotationId,
    position: position++,
    line_type: "part",
    title: p.description,
    details: null,
    group_label: p.part_request_id ? (labelOf.get(p.part_request_id) ?? "Parts") : "Parts",
    source_type: "manual",
    source_key: null,
    quantity: p.confirmed_quantity ?? p.quantity,
    unit_cost: p.cost_aed,
    markup_percent: minMarkup,
    part_item_id: p.id,
    created_by: by,
    updated_by: by,
  });
  if (rows.length) await admin.from("quotation_lines").insert(rows);
}


/** "Start quotation": suggested lines from the approved report (or the estimate), one part line per listed part. */
export async function startQuotation(jobId: string) {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, customer_id, vehicle_id, department, is_open, status, estimate_id, gated_in_by, job_kind").eq("id", jobId).maybeSingle();
  const err = (m: string) => redirect(`/jobs/${jobId}?error=${encodeURIComponent(m)}`);
  if (!job || !job.is_open) err("This job is closed.");
  const staff = await mayEdit(jobId, null);
  if (!staff) err("Only the job's advisor or the owner can start the quotation.");
  // Loose items have no inspection report: the quotation is the first step after gate-in.
  const loose = job!.job_kind === "loose";
  const bundle = loose ? null : await loadInspection(jobId);
  if (!loose && staff!.role_id !== "owner" && (!bundle || bundle.inspection.status !== "approved")) err("The quotation opens once the workshop manager has approved the inspection report.");
  if (!loose && staff!.role_id === "owner" && (!bundle || bundle.inspection.status !== "approved")) {
    // The owner may go ahead of the gate; it is written down.
    await admin.from("job_events").insert({ job_id: jobId, event_type: "override", note: `Quotation started by ${staff!.display_name} before the inspection report was approved. Reason: owner's decision.`, created_by: staff!.id });
  }
  const { data: existing } = await admin.from("quotations").select("id, status").eq("job_id", jobId).eq("is_active", true).in("status", ["draft", "pending_owner", "sent", "opened", "urgent_requested"]).limit(1).maybeSingle();
  if (existing) redirect(`/jobs/${jobId}/quote/${existing.id}`);

  const settings = await getSettings();
  const { data: vehicle } = await admin.from("vehicles").select("make:vehicle_makes(name)").eq("id", job!.vehicle_id).maybeSingle();
  const makeName = (vehicle?.make as unknown as { name: string } | null)?.name ?? null;
  const minMarkup = minMarkupFor(settings, makeName);
  const { data: created, error } = await admin
    .from("quotations")
    .insert({ kind: "quotation", job_id: jobId, customer_id: job!.customer_id, vehicle_id: job!.vehicle_id, estimate_id: job!.estimate_id, validity_days: Number(settings.quote_validity_days) || 7, vat_percent: 5, created_by: staff!.id, updated_by: staff!.id })
    .select("id, number")
    .single();
  if (error || !created) err(error?.message ?? "Could not start the quotation.");

  let lines: Record<string, unknown>[] = [];
  if (job!.estimate_id) {
    const { data: estLines } = await admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", job!.estimate_id).eq("is_active", true).order("position");
    lines = ((estLines ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => !l.fee_kind).map((l) => ({ quotation_id: created!.id, position: l.position, ...COPY_FIELDS(l), source_type: "estimate", source_key: l.id, part_item_id: null, created_by: staff!.id, updated_by: staff!.id }));
    // ONE commission per job: a commission set on the estimate moves onto the job's quotation whole,
    // and the estimate keeps a tombstone - it never lists as its own commission again.
    const { data: estCom } = await admin.from("quotations").select("number, commission_to, commission_kind, commission_value, commission_aed, commission_status, commission_set_by, commission_set_at, commission_decided_by, commission_decided_at, commission_decision_note").eq("id", job!.estimate_id).maybeSingle();
    if (estCom?.commission_to) {
      const comFields: Record<string, unknown> = { ...estCom, commission_status: estCom.commission_status ?? "approved" };
      delete comFields.number;
      await admin.from("quotations").update({ ...comFields, updated_by: staff!.id }).eq("id", created!.id);
      await admin.from("quotations").update({ commission_to: null, commission_kind: null, commission_value: null, commission_aed: 0, commission_status: "superseded", commission_decided_by: null, commission_decided_at: null, commission_decision_note: null, updated_by: staff!.id }).eq("id", job!.estimate_id);
      await logQuoteEvent(created!.id, jobId, staff!.id, "commission_carried", `${created!.number}: the commission for ${estCom.commission_to} moved over from estimate ${estCom.number}`);
      await logQuoteEvent(job!.estimate_id!, jobId, staff!.id, "commission_carried", `${estCom.number}: the commission for ${estCom.commission_to} moved to ${created!.number} when the estimate became the job's quotation`);
    }
    const { data: estTint } = await admin.from("quotations").select("tint_spec").eq("id", job!.estimate_id).maybeSingle();
    if (estTint?.tint_spec) await admin.from("quotations").update({ tint_spec: estTint.tint_spec, updated_by: staff!.id }).eq("id", created!.id);
  } else {
    // The labour list is the advisor's own: nothing from the report is pre-filled. The parts list comes from the approved report through the part requests below.
    lines = [];
  }
  if (lines.length) await admin.from("quotation_lines").insert(lines);
  // Tyres marked Replace on the report: one row, the count as the quantity, the positions on it. The advisor only checks it.
  if (bundle && !job!.estimate_id) {
    const m = (bundle.inspection.measurements ?? {}) as Record<string, string | number>;
    const replaced = TYRE_POSITIONS.filter((p) => ["replace_now", "replace_soon"].includes(String(m[`tyre_${p.key}_action`] ?? "")));
    if (replaced.length) {
      const { data: svcRows } = await admin.from("services").select(SERVICE_SELECT).eq("is_active", true);
      const svc = ((svcRows ?? []) as { id: string; name: string; price_aed: number | string | null; default_hours: number | string | null; price_per: string | null }[]).find((s) => /tyre/i.test(s.name) && /(fit|replac|chang)/i.test(s.name)) ?? null;
      const urgent = replaced.some((p) => String(m[`tyre_${p.key}_action`]) === "replace_now");
      const base = { quotation_id: created!.id, position: lines.length + 1, source_type: "tyre", source_key: "tyres", positions: replaced.map((p) => p.label), urgency: urgent ? "urgent" : null, created_by: staff!.id, updated_by: staff!.id };
      if (svc && svc.price_aed !== null) {
        await admin.from("quotation_lines").insert({ ...base, line_type: "package", title: svc.name, service_id: svc.id, unit_price: Number(svc.price_aed), price_per: svc.price_per ?? "tyre", quantity: replaced.length });
      } else {
        const hours = svc?.default_hours ? Math.round(Number(svc.default_hours) * replaced.length * 10) / 10 : null;
        await admin.from("quotation_lines").insert({ ...base, line_type: "labour", title: svc?.name ?? "Replace tyres (fitting and balancing)", service_id: svc?.id ?? null, hours, labour_rate: labourRateFor(settings, job!.department ?? null, makeName), quantity: 1 });
      }
    }
  }
  // Jobs the report marked Required (wheel alignment, wheel balancing...): the matching fixed-price service joins the quotation at once.
  const serviceCovered = new Set<string>();
  if (bundle && !job!.estimate_id) {
    const required = bundle.items.filter((i) => i.style === "job" && i.status === "bad");
    if (required.length) {
      const { data: svcRows } = await admin.from("services").select(SERVICE_SELECT).eq("is_active", true);
      const svcs = (svcRows ?? []) as unknown as { id: string; name: string; price_aed: number | string | null; price_per: string | null; line_kind: string | null; suggest_for: string[] | null; outside_work?: boolean }[];
      let pos = lines.length + 2;
      for (const it of required) {
        const svc = svcs.find((s) => (s.suggest_for ?? []).includes(it.item_key) && (s.line_kind ? s.line_kind === "service" : s.price_aed !== null));
        if (!svc) continue;
        serviceCovered.add(it.item_key);
        await admin.from("quotation_lines").insert({ quotation_id: created!.id, position: pos++, line_type: "package", title: svc.name, service_id: svc.id, unit_price: svc.price_aed === null ? null : Number(svc.price_aed), price_per: svc.price_per ?? "job", quantity: 1, source_type: "item", source_key: it.item_key, outside_work: !!svc.outside_work, created_by: staff!.id, updated_by: staff!.id });
      }
    }
  }
  // Every Bad or Average item with labour hours arrives as its own labour line, hours pre-filled (20 October 2026).
  if (bundle && !job!.estimate_id) {
    const withHours = bundle.items.filter((i) => (i.status === "bad" || i.status === "average") && Number(i.labour_hours) > 0 && !serviceCovered.has(i.item_key));
    if (withHours.length) {
      const { count } = await admin.from("quotation_lines").select("id", { count: "exact", head: true }).eq("quotation_id", created!.id);
      let hpos = (count ?? 0) + 1;
      const rate = labourRateFor(settings, job!.department ?? null, makeName);
      for (const it of withHours) {
        await admin.from("quotation_lines").insert({ quotation_id: created!.id, position: hpos++, line_type: "labour", title: it.item_label, hours: Number(it.labour_hours), labour_rate: rate, quantity: 1, urgency: it.status === "bad" ? "urgent" : null, source_type: "item", source_key: it.item_key, created_by: staff!.id, updated_by: staff!.id });
      }
    }
  }
  // A car that came on our recovery truck: the recovery line is suggested, the advisor fills in the price or hides it.
  const { data: gateIn } = await admin.from("gate_ins").select("arrived_by, recovery_type").eq("job_id", jobId).maybeSingle();
  if (gateIn?.arrived_by === "our_recovery" && !lines.some((l) => l.line_type === "recovery")) {
    const types = (settings.recovery_types ?? []) as { key: string; label: string; cost: number; price: number }[];
    const rt = types.find((t) => t.key === gateIn.recovery_type) ?? types[0] ?? null;
    await admin.from("quotation_lines").insert({ quotation_id: created!.id, position: lines.length + 1, line_type: "recovery", title: recoveryTitle(rt?.label ?? null, 1), details: null, source_type: "manual", quantity: 1, recovery_trips: 1, recovery_type: rt?.key ?? null, unit_cost: rt ? Number(rt.cost) || 0 : null, unit_price: rt ? Number(rt.price) || 0 : null, recovery_provider_kind: "ours", markup_percent: minMarkup, visible_to_customer: true, created_by: staff!.id, updated_by: staff!.id });
  }
  await ensurePartRequests(jobId, staff!.id);
  await syncPartLines(created!.id, jobId, staff!.id, minMarkup);
  await refreshQuoteTotals(created!.id, settings, staff!.id);
  await logQuoteEvent(created!.id, jobId, staff!.id, "quote_started", `Quotation ${created!.number} started by ${staff!.display_name}${job!.estimate_id ? " from the estimate" : ""}`);
  refresh(jobId, created!.id);
  redirect(`/jobs/${jobId}/quote/${created!.id}`);
}

/** A further quotation on the same job, for extra work found later. */
export async function newQuotation(jobId: string) {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, customer_id, vehicle_id, department, is_open").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) redirect(`/jobs/${jobId}?error=${encodeURIComponent("This job is closed.")}`);
  const staff = await mayEdit(jobId, null);
  if (!staff) redirect(`/jobs/${jobId}?error=${encodeURIComponent("Only the job's advisor or the owner can add a quotation.")}`);
  const settings = await getSettings();
  const { data: created, error } = await admin
    .from("quotations")
    .insert({ kind: "quotation", job_id: jobId, customer_id: job.customer_id, vehicle_id: job.vehicle_id, validity_days: Number(settings.quote_validity_days) || 7, created_by: staff.id, updated_by: staff.id })
    .select("id, number")
    .single();
  if (error || !created) redirect(`/jobs/${jobId}?error=${encodeURIComponent(error?.message ?? "Could not add the quotation.")}`);
  await logQuoteEvent(created.id, jobId, staff.id, "quote_started", `Quotation ${created.number} started by ${staff.display_name} for extra work`);
  refresh(jobId, created.id);
  redirect(`/jobs/${jobId}/quote/${created.id}`);
}

/** A new version with the same lines, or with the urgent lines only; the old version is kept as replaced. */
async function makeVersion(quotationId: string, urgentOnly: boolean) {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) redirect("/dashboard");
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  const back = q.kind === "estimate" ? `/estimates/${quotationId}` : `/jobs/${q.job_id}/quote/${quotationId}`;
  if (!staff) redirect(`${back}?error=${encodeURIComponent("Not allowed.")}`);
  if (!["sent", "opened", "expired", "declined", "approved", "pending_owner", "urgent_requested"].includes(q.status)) redirect(back);
  // Locked by a document: with a proforma out only the owner makes a new version; with a tax invoice out nobody does (credit note).
  const lockInfo = await loadQuoteLock(q.id, { isOwner: staff.role_id === "owner" });
  if (lockInfo?.lock.locked && (lockInfo.lock.reviseBy === "nobody" || (lockInfo.lock.reviseBy === "owner" && staff.role_id !== "owner"))) {
    const refused = await refuseIfLocked(q.id, staff.id, "revise the quotation", "quotation page");
    redirect(`${back}?error=${encodeURIComponent(refused ?? "Locked.")}`);
  }
  // The customer approved this quotation: the owner revises it directly; anyone else needs the owner's one-time permission.
  if (q.status === "approved" && q.kind === "quotation" && staff.role_id !== "owner") {
    if (!q.revision_allowed_at) redirect(`${back}?error=${encodeURIComponent("The customer approved this quotation. Ask the owner to allow a revision first.")}`);
    await createAdminClient().from("quotations").update({ revision_allowed_at: null, revision_allowed_by: null, updated_by: staff.id }).eq("id", q.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "revision_used", `${q.number}: the owner's permission to revise was used by ${staff.display_name}`);
  }
  const r = await createNextVersion(quotationId, staff, { urgentOnly });
  if ("error" in r) redirect(`${back}?error=${encodeURIComponent(r.error)}`);
  refresh(q.job_id, r.id);
  redirect(q.kind === "estimate" ? `/estimates/${r.id}` : `/jobs/${q.job_id}/quote/${r.id}`);
}


export async function reviseQuotation(quotationId: string) {
  await makeVersion(quotationId, false);
}

/** "Ask owner to revise" on a quotation the customer approved: the reason goes to the owner, who allows one revision or declines. */
export async function requestRevision(quotationId: string, formData: FormData) {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) redirect("/dashboard");
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  const back = `/jobs/${q.job_id}/quote/${quotationId}`;
  if (!staff) redirect(`${back}?error=${encodeURIComponent("Not allowed.")}`);
  if (q.status !== "approved") redirect(`${back}?error=${encodeURIComponent("Only a quotation the customer approved needs the owner's permission.")}`);
  // A proforma or a tax invoice is out: not even the asking is open to an advisor (the owner revises, or a credit note settles it).
  const lockInfo = await loadQuoteLock(q.id);
  if (lockInfo?.lock.locked && lockInfo.lock.reviseBy !== "owner_or_allowed") {
    const refused = await refuseIfLocked(q.id, staff.id, "ask for a revision", "quotation page");
    redirect(`${back}?error=${encodeURIComponent(refused ?? "Locked.")}`);
  }
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) redirect(`${back}?error=${encodeURIComponent("Write why the quotation has to change.")}`);
  const pending = !!q.revision_requested_at && !q.revision_declined_at && !q.revision_allowed_at;
  await askOwnerForRevision({ id: q.id, number: q.number, job_id: q.job_id, pending }, staff.id, staff.display_name, reason, "advisor");
  refresh(q.job_id, q.id);
  redirect(`${back}?message=${encodeURIComponent(pending ? "The owner has already been asked; waiting for the answer." : "The owner has been asked to allow a revision.")}`);
}

/** The owner's answer to a revision request: Allow (one revision; a Parts request makes the new version at once) or Decline. */
export async function decideRevision(quotationId: string, formData: FormData) {
  const staff = await requirePermission("approveQuotes");
  const bundle = await loadQuotation(quotationId);
  if (!bundle) redirect("/dashboard");
  const q = bundle.quotation;
  const back = `/jobs/${q.job_id}/quote/${quotationId}`;
  const decision = String(formData.get("decision") ?? "");
  const note = blankToNull(formData.get("note"));
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const requester = q.revision_requested_by ? [q.revision_requested_by] : [];
  if (decision === "allow") {
    const live = liveInvoicesOf(await invoicesForLock(q.job_id));
    if (live.tax) redirect(`${back}?error=${encodeURIComponent(`Tax invoice ${live.tax.number} has been issued for this job: the quotation cannot be revised any more. Issue a credit note on the invoice page instead.`)}`);
    await admin.from("quotations").update({ revision_allowed_at: now, revision_allowed_by: staff.id, revision_declined_at: null, revision_declined_by: null, revision_decision_note: note, updated_by: staff.id }).eq("id", q.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "revision_allowed", `${q.number}: the owner allowed one revision${note ? `: ${note}` : ""}`);
    if (q.revision_request_kind === "parts" && q.job_id) {
      // The change from Parts: the new version is made now, with every priced part on it; the advisor sends it.
      const r = await createNextVersion(q.id, staff, { reason: "parts changed, allowed by the owner" });
      if (!("error" in r)) {
        await admin.from("quotations").update({ revision_allowed_at: null, revision_allowed_by: null, updated_by: staff.id }).eq("id", q.id);
        const ids = Array.from(new Set([q.created_by, q.sent_by, ...requester].filter((x): x is string => !!x)));
        await notifyStaff(ids, { type: "quote_revised_by_parts", title: `Owner allowed the revised ${q.number}: send it`, body: `Version ${r.version} is ready with the change from Parts.${note ? ` Owner: ${note}` : ""}`, jobId: q.job_id, href: `/jobs/${q.job_id}/quote/${r.id}?send=1` });
        refresh(q.job_id, r.id);
        redirect(`/jobs/${q.job_id}/quote/${r.id}?message=${encodeURIComponent(`Allowed. Version ${r.version} is ready to send.`)}`);
      }
    }
    await notifyStaff(requester.length ? requester : [q.created_by].filter((x): x is string => !!x), { type: "revision_request", title: `Owner allowed one revision of ${q.number}`, body: `Press Revise quotation on the quotation page.${note ? ` Owner: ${note}` : ""}`, jobId: q.job_id, href: back });
    refresh(q.job_id, q.id);
    redirect(`${back}?message=${encodeURIComponent("Allowed: one revision can be made.")}`);
  }
  await admin.from("quotations").update({ revision_declined_at: now, revision_declined_by: staff.id, revision_decision_note: note, updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "revision_declined", `${q.number}: the owner declined the revision${note ? `: ${note}` : ""}`);
  await notifyStaff(requester.length ? requester : [q.created_by].filter((x): x is string => !!x), { type: "revision_request", title: `Owner declined the revision of ${q.number}`, body: note ?? "The approved quotation stands.", jobId: q.job_id, href: back });
  refresh(q.job_id, q.id);
  redirect(`${back}?message=${encodeURIComponent("Declined. The approved quotation stands.")}`);
}

/** The battery warranty the advisor picks on the battery line (12, 24 or 36 months); the sticker and the warranty record follow it. */
export async function setPartWarranty(partId: string, months: number): Promise<{ ok?: boolean; error?: string }> {
  const staff = await requirePermission("editQuotes");
  const m = Math.round(Number(months));
  if (!Number.isFinite(m) || m < 1 || m > 120) return { error: "Pick 12, 24 or 36 months." };
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, description").eq("id", partId).maybeSingle();
  if (!p) return { error: "Part not found." };
  const { error } = await admin.from("part_items").update({ warranty_months: m, updated_by: staff.id }).eq("id", partId);
  if (error) return { error: error.message };
  await admin.from("job_events").insert({ job_id: p.job_id, event_type: "amendment", note: `Battery warranty ${m} months on ${p.description} (${staff.display_name})`, created_by: staff.id });
  revalidatePath(`/jobs/${p.job_id}`);
  return { ok: true };
}

/** A job typed by hand on a quotation, saved to the services list with one tap (category "Custom", the owner tidies it in Settings). */
export async function saveCustomService(name: string, kind: "labour" | "service"): Promise<{ ok?: boolean; error?: string }> {
  const staff = await requirePermission("editQuotes");
  const clean = name.trim().slice(0, 120);
  if (clean.length < 2) return { error: "Type the name first." };
  const admin = createAdminClient();
  const { data: dup } = await admin.from("services").select("id").eq("is_active", true).ilike("name", clean).limit(1);
  if ((dup ?? []).length) return { ok: true };
  let { data: cat } = await admin.from("service_categories").select("id").eq("is_active", true).ilike("name", "Custom").limit(1).maybeSingle();
  if (!cat) {
    const { data: last } = await admin.from("service_categories").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: made } = await admin.from("service_categories").insert({ name: "Custom", position: (Number(last?.position) || 0) + 1, created_by: staff.id, updated_by: staff.id }).select("id").maybeSingle();
    cat = made ?? null;
  }
  if (!cat) return { error: "Could not make the Custom category." };
  const { data: lastSvc } = await admin.from("services").select("position").eq("category_id", cat.id).order("position", { ascending: false }).limit(1).maybeSingle();
  const { error } = await admin.from("services").insert({ category_id: cat.id, name: clean, department: "both", price_aed: null, default_hours: null, line_kind: kind, price_per: "job", position: (Number(lastSvc?.position) || 0) + 1, created_by: staff.id, updated_by: staff.id });
  if (error) return { error: error.message };
  revalidatePath("/settings/services");
  return { ok: true };
}

/** "Create urgent-only version": the Urgent lines carry over; the rest is saved against the car as declined work. */
export async function urgentOnlyVersion(quotationId: string) {
  await makeVersion(quotationId, true);
}

export type SendQuoteState = { error?: string; ok?: boolean; token?: string; /** The short address for the message (erp.ofjauto.com/m/xxxx). */ short?: string; pendingOwner?: string[]; /** A free comeback: approved on sending, nothing goes to the customer. */ warranty?: boolean };

/** "Send quotation": checks everything, asks the owner when needed, otherwise makes the link for the centre window. */
export async function sendQuotation(quotationId: string, _prev: SendQuoteState, _fd?: FormData): Promise<SendQuoteState> {
  void _prev;
  void _fd;
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Only the job's advisor or the owner can send it." };
  if (q.status === "sent" || q.status === "opened") return { ok: true, token: q.token ?? undefined };
  if (q.status !== "draft" && q.status !== "pending_owner") return { error: `This quotation is ${q.status.replace("_", " ")}. Revise it to send a new version.` };
  const settings = await getSettings();
  const checks = await loadQuoteChecks(q.job_id);
  const blockers = await quoteBlockers(bundle, settings, checks);
  if (blockers.length) return { error: blockers.map((b) => b.label).join(" · ") };
  const admin = createAdminClient();
  if (!q.completed_at) {
    // The advisor presses "Quotation complete" first. The owner may send straight away; it is written down.
    if (staff.role_id !== "owner") return { error: "Press \"Quotation complete\" first, then send it." };
    await admin.from("quotations").update({ completed_at: new Date().toISOString(), completed_by: staff.id, updated_by: staff.id }).eq("id", q.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "quote_complete", `${q.number} v${q.version} marked complete by ${staff.display_name} on sending (owner)`);
  }
  const totals = quoteTotals(bundle.lines, q, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const reasons = ownerApprovalReasons(q, bundle.lines, totals, { discountLimit: Number(settings.discount_limit_percent) || 0, approvalAbove: Number(settings.quote_owner_approval_above_aed) || 0 });
  if (reasons.length && staff.role_id !== "owner" && !q.owner_approved_at) {
    if (q.status !== "pending_owner") {
      await admin.from("quotations").update({ status: "pending_owner", owner_approval_reason: reasons.join("; "), updated_by: staff.id }).eq("id", q.id);
      await logQuoteEvent(q.id, q.job_id, staff.id, "quote_owner_approval", `${q.number} sent to the owner for approval: ${reasons.join("; ")}`);
      await notifyRoles(["owner"], { type: "quote_owner_approval", title: `Quotation needs your approval · ${q.number}`, body: reasons.join("; "), jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}/quote/${q.id}` : `/estimates/${q.id}` });
      refresh(q.job_id, q.id);
    }
    return { pendingOwner: reasons };
  }
  const token = q.token ?? quoteToken();
  const validUntil = new Date(Date.now() + (Number(q.validity_days) || 7) * 86400000).toISOString();
  // The link goes to the customer on file; that name and number stay with the answer.
  const patch: Record<string, unknown> = { token, valid_until: validUntil, status: "draft", sent_to_name: bundle.customer?.company_name ?? bundle.customer?.full_name ?? null, sent_to_phone: bundle.customer?.phone ?? null, updated_by: staff.id };
  if (reasons.length && staff.role_id === "owner") Object.assign(patch, { owner_approved_by: staff.id, owner_approved_at: new Date().toISOString(), owner_approval_reason: reasons.join("; ") });
  const { error } = await admin.from("quotations").update(patch).eq("id", q.id);
  if (error) return { error: error.message };
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_link_created", `${q.number} v${q.version} link created by ${staff.display_name}`);
  // A free comeback (warranty repair): the owner has decided; the quotation is approved on sending, nothing goes to the customer.
  if (q.job_id && bundle.job && (bundle.job as { comeback_free?: boolean }).comeback_free) {
    const r = await applyCustomerResponse(q.id, { approve: true, name: `Warranty repair (${staff.display_name})`, by: staff.id, via: "warranty" });
    if (r.error) return { error: r.error };
    refresh(q.job_id, q.id);
    return { ok: true, token, warranty: true };
  }
  refresh(q.job_id, q.id);
  return { ok: true, token, short: await shortFor(`${PRODUCTION_SITE_URL}/quote/${token}`) };
}

/** Records that the link went to the customer; the quotation is now "sent" and the job waits for the customer. */
export async function markQuoteSent(quotationId: string, method: string): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  const admin = createAdminClient();
  if (q.status === "draft" && q.token) {
    await admin.from("quotations").update({ status: "sent", sent_at: new Date().toISOString(), sent_by: staff.id, sent_method: method.slice(0, 20), updated_by: staff.id }).eq("id", q.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "quote_sent", `${q.number} v${q.version} sent to the customer by ${staff.display_name} (${method})`);
    if (q.job_id) {
      // Sent by someone other than the car's advisor: the advisor is told.
      const advisors = await advisorsInCharge(q.job_id);
      if (advisors.length && !advisors.includes(staff.id)) await notifyStaff(advisors, { type: "quote_other_editor", title: `${staff.display_name} sent ${q.number} · ${bundle.job?.job_number ?? ""}`, body: "Your car's quotation went to the customer, sent by someone else.", jobId: q.job_id, href: `/jobs/${q.job_id}/quote/${q.id}` });
    }
    if (q.job_id && bundle.job && (bundle.job.status === "pending_quote" || bundle.job.status === "in_inspection")) {
      await admin.from("jobs").update({ status: "pending_customer_approval", stage: "approval", stage_entered_at: new Date().toISOString() }).eq("id", q.job_id);
      await admin.from("job_events").insert({ job_id: q.job_id, event_type: "status_change", from_status: bundle.job.status, to_status: "pending_customer_approval", note: `Quotation ${q.number} sent`, created_by: staff.id });
    }
  }
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** The owner approves or refuses a quotation that needed approval. */
export async function decideQuoteApproval(quotationId: string, formData: FormData) {
  const staff = await requirePermission("approveQuotes");
  const bundle = await loadQuotation(quotationId);
  if (!bundle) redirect("/dashboard");
  const q = bundle.quotation;
  const back = q.kind === "estimate" ? `/estimates/${quotationId}` : `/jobs/${q.job_id}/quote/${quotationId}`;
  const decision = String(formData.get("decision") ?? "");
  const note = blankToNull(formData.get("note"));
  const admin = createAdminClient();
  if (decision === "approve") {
    await admin.from("quotations").update({ status: "draft", owner_approved_by: staff.id, owner_approved_at: new Date().toISOString(), updated_by: staff.id }).eq("id", q.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "quote_owner_approved", `Owner approved ${q.number}${note ? `: ${note}` : ""}`);
  } else {
    await admin.from("quotations").update({ status: "draft", owner_approval_reason: null, updated_by: staff.id }).eq("id", q.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "quote_owner_refused", `Owner asked for changes on ${q.number}${note ? `: ${note}` : ""}`);
  }
  if (q.created_by) await notifyStaff([q.created_by], { type: "quote_owner_approval", title: decision === "approve" ? `Owner approved ${q.number}: send it` : `Owner asked for changes on ${q.number}`, body: note ?? "", jobId: q.job_id, href: back });
  refresh(q.job_id, q.id);
  redirect(`${back}?message=${encodeURIComponent(decision === "approve" ? "Approved. The advisor can send it now." : "Sent back to the advisor.")}`);
}

/** A quotation made from an accepted estimate with nothing changed: the earlier acceptance counts as approval. */
export async function confirmEstimateUnchanged(quotationId: string) {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) redirect("/dashboard");
  const q = bundle.quotation;
  const back = `/jobs/${q.job_id}/quote/${quotationId}`;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) redirect(`${back}?error=${encodeURIComponent("Not allowed.")}`);
  if (!q.estimate_id || q.status !== "draft") redirect(back);
  const admin = createAdminClient();
  const { data: est } = await admin.from("quotations").select("status, approver_name, sent_to_phone").eq("id", q.estimate_id).maybeSingle();
  if (!est || est.status !== "approved") redirect(`${back}?error=${encodeURIComponent("The estimate was not accepted by the customer.")}`);
  const settings = await getSettings();
  const blockers = await quoteBlockers(bundle, settings, { openRequests: 0, workshopEstimate: null });
  if (blockers.length) redirect(`${back}?error=${encodeURIComponent(blockers.map((b) => b.label).join(" · "))}`);
  await admin.from("quotations").update({ token: q.token ?? quoteToken(), sent_to_phone: est.sent_to_phone ?? bundle.customer?.phone ?? null, updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_confirmed_from_estimate", `${q.number} confirmed by ${staff.display_name} as unchanged from the accepted estimate`);
  const res = await applyCustomerResponse(q.id, { approve: true, name: est.approver_name ?? "Customer", by: staff.id, via: "estimate" });
  refresh(q.job_id, q.id);
  redirect(`${back}?${res.error ? `error=${encodeURIComponent(res.error)}` : `message=${encodeURIComponent("Confirmed. The estimate's acceptance counts as the customer's approval.")}`}`);
}

/** Re-sends an expired quotation: a fresh validity period on the same link. */
export async function resendQuotation(quotationId: string): Promise<SendQuoteState> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  if (q.status !== "expired") return { error: "Only an expired quotation can be re-sent." };
  const admin = createAdminClient();
  const token = q.token ?? quoteToken();
  await admin.from("quotations").update({ status: "sent", token, valid_until: new Date(Date.now() + (Number(q.validity_days) || 7) * 86400000).toISOString(), sent_at: new Date().toISOString(), sent_by: staff.id, updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_resent", `${q.number} re-sent by ${staff.display_name}`);
  refresh(q.job_id, q.id);
  return { ok: true, token, short: await shortFor(`${PRODUCTION_SITE_URL}/quote/${token}`) };
}

/** The checks before completing or sending: the findings not yet quoted and the markups to confirm are counted in. */
async function quoteBlockers(bundle: NonNullable<Awaited<ReturnType<typeof loadQuotation>>>, settings: Awaited<ReturnType<typeof getSettings>>, checks: { openRequests: number; workshopEstimate: { hours: number | null; managerHours: number | null; agreed: boolean } | null }) {
  const q = bundle.quotation;
  // Findings not quoted never block: the advisor sees them as a reference list and decides.
  return sendBlockers(q, bundle.lines, bundle.parts, { minMarkup: minMarkupFor(settings, bundle.vehicle?.make?.name ?? null), ...checks, confirmPercent: Number(settings.markup_confirm_percent) || 100 });
}

/**
 * "Quotation complete": every check passes, the labour hours are remembered for the next quotation on
 * the same work, and descriptions typed by hand are counted so the owner can add them to the list.
 */
export async function completeQuotation(quotationId: string, opts: { /** "Send anyway" on the low-profit warning: logged, the owner told. */ lowProfitOk?: boolean; /** "Continue anyway" on the markup reminder: logged, no approval needed. */ skipMarkup?: boolean; /** "Leave them off" on the missing-parts check: logged. */ skipParts?: boolean; /** "Send without a deposit" on the deposit reminder: logged. */ skipDeposit?: boolean } = {}): Promise<{ error?: string; ok?: boolean; ask?: "low_profit" | "markup" | "parts" | "deposit"; message?: string; missing?: string[] }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Only the job's advisor or the owner can complete it." };
  if (q.status !== "draft" && q.status !== "pending_owner") return { error: (await refuseIfLocked(q.id, staff.id, "change the quotation", "quotation page")) ?? "This version has been sent." };
  const settings = await getSettings();
  const admin = createAdminClient();
  const checks = await loadQuoteChecks(q.job_id);
  const blockers = await quoteBlockers(bundle, settings, checks);
  if (blockers.length) return { error: `Not complete yet: ${blockers.map((b) => b.label).join(" · ")}` };
  const active = bundle.lines.filter((l) => l.is_active);
  // A red-margin quotation asks once: "This is too low of a profit (AED x on AED y, z%). Are you sure you want to send?".
  // "Send anyway" is allowed; the log and the owner's message are written when the completion really happens (below),
  // so answering the markup or deposit question afterwards never tells the owner twice.
  let lowProfit: { marginPct: number; profit: number; net: number } | null = null;
  if (q.kind === "quotation") {
    const t = quoteTotals(bundle.lines, q, { technicianCostRate: Number((settings.technician_cost_rate_by_department as Record<string, number> | null)?.[bundle.job?.department ?? "mechanical"]) || Number(settings.technician_cost_rate_aed) || 0 });
    const limits = { yellow: Number(settings.quote_margin_yellow_percent) || 30, red: Number(settings.quote_margin_red_percent) || 20 };
    const marginPct = t.net > 0 ? (t.profit / t.net) * 100 : 0;
    if (marginToneOf(t.profit, t.net, limits) === "red") {
      if (!opts.lowProfitOk) return { ask: "low_profit", message: `This is too low of a profit (${aed(t.profit)} on ${aed(t.net)}, ${marginPct.toFixed(marginPct < 10 ? 1 : 0)}%). Are you sure you want to send?` };
      lowProfit = { marginPct, profit: t.profit, net: t.net };
    }
  }
  // The parts markup never moved off the minimum: asked once (Set markup / Continue anyway); "Continue anyway" is logged for the owner's summary.
  const minMarkup = Number(settings.parts_min_markup_percent) || 5;
  const partLines = active.filter((l) => l.line_type === "part" && !isUnchosen(l) && !l.left_off);
  const markupUntouched = partLines.length > 0 && partLines.every((l) => Math.abs((Number(l.markup_percent) || 0) - minMarkup) < 0.001);
  if (markupUntouched && !q.markup_skipped_at) {
    if (!opts.skipMarkup) return { ask: "markup", message: `Parts markup is still at the minimum ${minMarkup}%. Set it now?` };
    await admin.from("quotations").update({ markup_skipped_at: new Date().toISOString(), markup_skipped_by: staff.id, updated_by: staff.id }).eq("id", q.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "markup_skipped", `${q.number} v${q.version}: parts markup left at the minimum ${minMarkup}% by ${staff.display_name} (Continue anyway)`);
  }
  // Every priced part (Our stock included) must be on the quotation: the missing ones are added with one tap.
  if (q.kind === "quotation" && q.job_id) {
    const missing = await missingPricedParts(q.job_id, q.id);
    if (missing.length && !opts.skipParts) return { ask: "parts", message: `${missing.length} priced part${missing.length === 1 ? " is" : "s are"} missing from the quote`, missing: missing.map((m) => m.description) };
    const { data: lastEvent } = missing.length && opts.skipParts ? await admin.from("quotation_events").select("event_type").eq("quotation_id", q.id).order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
    if (missing.length && opts.skipParts && lastEvent?.event_type !== "parts_left_off") await logQuoteEvent(q.id, q.job_id, staff.id, "parts_left_off", `${q.number} v${q.version} completed by ${staff.display_name} without ${missing.length} priced part${missing.length === 1 ? "" : "s"}: ${missing.map((m) => m.description).join(", ")}`);
  }
  // No deposit asked for while the parts are above the Settings threshold, or the note to the customer
  // mentions an advance or deposit without one set: asked once (Add deposit / Send without, logged).
  if (q.kind === "quotation") {
    const threshold = Number(settings.deposit_threshold_aed) || 0;
    const partsSell = quoteTotals(bundle.lines, q).partsSell;
    const noDeposit = !q.deposit_mode || q.deposit_mode === "none" || !(Number(q.deposit_aed) > 0);
    const noteMentions = /\b(advance|deposit)\b/i.test(`${q.customer_note ?? ""} ${q.customer_request_note ?? ""}`);
    const bigParts = threshold > 0 && partsSell > threshold;
    if ((bigParts || noteMentions) && noDeposit && !q.deposit_skipped_at) {
      if (!opts.skipDeposit) return { ask: "deposit", message: noteMentions && !bigParts ? "Your note to the customer mentions an advance or deposit, but none is set on this quote. Did you mean to ask for a deposit?" : `Big parts order (AED ${partsSell.toLocaleString("en-GB")}) and no deposit on this quote. Ask for a deposit?` };
      await admin.from("quotations").update({ deposit_skipped_at: new Date().toISOString(), deposit_skipped_by: staff.id, updated_by: staff.id }).eq("id", q.id);
      await logQuoteEvent(q.id, q.job_id, staff.id, "deposit_skipped", `${q.number} v${q.version}: completed without a deposit by ${staff.display_name}${bigParts ? ` (parts AED ${partsSell.toLocaleString("en-GB")})` : " (the note mentioned an advance)"}`);
    }
  }
  const workLines = active.filter((l) => l.line_type !== "part" && !l.fee_kind);
  // Custom jobs typed by hand are counted; the owner sees them in Settings > Jobs and services and adds them to the list with one tap.
  const { data: svcNames } = await admin.from("services").select("name").eq("is_active", true);
  const known = new Set((svcNames ?? []).map((s) => String(s.name).toLowerCase()));
  const cand = { ...((settings.custom_jobs_used ?? {}) as Record<string, number>) };
  let candChanged = false;
  for (const l of workLines) {
    if (l.line_type !== "labour" || l.service_id || !l.title.trim()) continue;
    const t = l.title.trim().replace(/,\s*(front and rear|front|rear|left|right)$/i, "");
    if (known.has(t.toLowerCase())) continue;
    const k = Object.keys(cand).find((x) => x.toLowerCase() === t.toLowerCase()) ?? t;
    cand[k] = (cand[k] ?? 0) + 1;
    candChanged = true;
  }
  if (candChanged) await admin.from("settings").upsert({ key: "custom_jobs_used", value: cand, label: "Custom jobs used", description: "Custom job names typed on quotations, with counts, offered to the owner to add to the list." }, { onConflict: "key" });
  const memory = { ...((settings.labour_hours_memory ?? {}) as Record<string, number>) };
  const model = [bundle.vehicle?.make?.name, bundle.vehicle?.model?.name].filter(Boolean).join(" ").toLowerCase();
  let remembered = false;
  for (const l of workLines) {
    if (l.line_type !== "labour" || !l.hours || l.hours <= 0) continue;
    const k = l.title.trim().toLowerCase();
    for (const key of [k, model ? `${model}|${k}` : ""]) {
      if (key && memory[key] !== l.hours) {
        memory[key] = l.hours;
        remembered = true;
      }
    }
  }
  if (remembered) await admin.from("settings").update({ value: memory }).eq("key", "labour_hours_memory");
  // "Send anyway" on the low-profit warning: written on the quotation, the owner told once.
  if (lowProfit) {
    const plate = bundle.vehicle ? formatPlate(bundle.vehicle) : bundle.job?.job_number ?? q.number;
    await logQuoteEvent(q.id, q.job_id, staff.id, "low_profit_sent", `${q.number} v${q.version} completed at a ${lowProfit.marginPct.toFixed(1)}% margin (${aed(lowProfit.profit)} on ${aed(lowProfit.net)}) by ${staff.display_name}: Send anyway`);
    if (staff.role_id !== "owner") await notifyRoles(["owner"], { type: "low_profit", title: `Low-profit quote sent by ${staff.display_name}: ${plate}, ${lowProfit.marginPct.toFixed(1)}%`, body: `${q.number}: ${aed(lowProfit.profit)} profit on ${aed(lowProfit.net)} before VAT. The limits are in Settings.`, jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}/quote/${q.id}` : `/estimates/${q.id}` });
  }
  await admin.from("quotations").update({ completed_at: new Date().toISOString(), completed_by: staff.id, updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_complete", `${q.number} v${q.version} marked complete by ${staff.display_name}`);
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** The advisor marks a quotation declined after talking to the customer, with an optional reason. The customer's page has no Declined button. */
export async function declineQuotation(quotationId: string, formData: FormData) {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) redirect("/dashboard");
  const q = bundle.quotation;
  const back = q.job_id ? `/jobs/${q.job_id}/quote/${q.id}` : `/estimates/${q.id}`;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) redirect(`${back}?error=${encodeURIComponent("Only the job's advisor or the owner can mark it declined.")}`);
  if (!["sent", "opened", "expired"].includes(q.status)) redirect(`${back}?error=${encodeURIComponent("Only a sent quotation can be marked declined.")}`);
  const note = blankToNull(formData.get("reason"));
  const res = await applyCustomerResponse(q.id, { approve: false, name: staff.display_name, by: staff.id, via: "advisor", note });
  if (res.error) redirect(`${back}?error=${encodeURIComponent(res.error)}`);
  refresh(q.job_id, q.id);
  redirect(`${back}?message=${encodeURIComponent("Marked as declined.")}`);
}

/** Back to editing after "Quotation complete". */
export async function reopenQuotation(quotationId: string): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  if (!q.completed_at) return { ok: true };
  const admin = createAdminClient();
  await admin.from("quotations").update({ completed_at: null, completed_by: null, updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_reopened", `${q.number} v${q.version} reopened by ${staff.display_name}`);
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** "Remind Parts": after the set number of minutes, one tap tells Parts the quotation is waiting on them. */
export async function remindParts(quotationId: string): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle || !bundle.job) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  const settings = await getSettings();
  const wait = await loadPartsWait(bundle.job.id);
  if (!wait.count) return { error: "Nothing is waiting on Parts." };
  const after = Number(settings.parts_remind_minutes) || 30;
  if (wait.minutes < after) return { error: `Remind Parts after ${after} minutes (${wait.minutes} so far).` };
  const admin = createAdminClient();
  await notifyRoles(["parts"], { type: "parts_reminder", title: `Reminder: parts to price · ${bundle.job.job_number}`, body: `${staff.display_name} is waiting for ${wait.count} price${wait.count === 1 ? "" : "s"} on ${q.number} (${wait.minutes} min).`, jobId: bundle.job.id, href: `/parts/${bundle.job.id}` });
  await admin.from("quotations").update({ parts_reminded_at: new Date().toISOString(), updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "parts_reminded", `${staff.display_name} reminded Parts about ${q.number} after ${wait.minutes} min`);
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** "Escalate": after a longer wait, the owner hears about it too. */
export async function escalateParts(quotationId: string): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle || !bundle.job) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  const settings = await getSettings();
  const wait = await loadPartsWait(bundle.job.id);
  if (!wait.count) return { error: "Nothing is waiting on Parts." };
  const after = Number(settings.parts_escalate_minutes) || 60;
  if (wait.minutes < after) return { error: `Escalate after ${after} minutes (${wait.minutes} so far).` };
  const admin = createAdminClient();
  const body = `${q.number} on ${bundle.job.job_number} has waited ${wait.minutes} min for ${wait.count} price${wait.count === 1 ? "" : "s"} from Parts (${wait.names.join(", ") || "Parts"}).`;
  await notifyRoles(["owner"], { type: "parts_escalation", title: `Parts are holding a quotation · ${bundle.job.job_number}`, body, jobId: bundle.job.id, href: `/parts/${bundle.job.id}` });
  await notifyRoles(["parts"], { type: "parts_escalation", title: `Escalated to the owner · ${bundle.job.job_number}`, body, jobId: bundle.job.id, href: `/parts/${bundle.job.id}` });
  await admin.from("quotations").update({ parts_escalated_at: new Date().toISOString(), updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "parts_escalated", `${staff.display_name} escalated the parts wait on ${q.number} to the owner after ${wait.minutes} min`);
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** The whole-dirham total chosen when sending; the pre-VAT amount takes the difference so VAT and the total agree. */
export async function roundQuotation(quotationId: string, total: number): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  if (q.status !== "draft" && q.status !== "pending_owner") return { error: (await refuseIfLocked(q.id, staff.id, "change the quotation", "quotation page")) ?? "This version has been sent." };
  const whole = Math.round(total);
  if (!Number.isFinite(whole) || whole <= 0 || Math.abs(whole - q.total_aed) > Math.max(10, q.total_aed * 0.02)) return { error: "That rounded total is too far from the quotation total." };
  const admin = createAdminClient();
  await admin.from("quotations").update({ rounded_total_aed: whole, updated_by: staff.id }).eq("id", q.id);
  await refreshQuoteTotals(q.id, await getSettings(), staff.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_rounded", `${q.number} v${q.version} total rounded from ${q.total_aed.toFixed(2)} to ${whole} by ${staff.display_name}`);
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** On a revised quotation: keep the labour lines marked Urgent and their parts; every other charge stays. The rest is removed from this version. */
export async function keepUrgentOnly(quotationId: string): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  if (q.status !== "draft" && q.status !== "pending_owner") return { error: (await refuseIfLocked(q.id, staff.id, "change the quotation", "quotation page")) ?? "This version has been sent." };
  const admin = createAdminClient();
  const drop = bundle.lines.filter((l) => l.is_active && blockOf(l) === "labour" && l.urgency !== "urgent");
  const dropIds = new Set(drop.map((l) => l.id));
  const parts = bundle.lines.filter((l) => l.is_active && blockOf(l) === "parts" && l.parent_line_id && dropIds.has(l.parent_line_id));
  const ids = [...drop, ...parts].map((l) => l.id);
  if (!ids.length) return { error: "Nothing to remove." };
  await admin.from("quotation_lines").update({ is_active: false, updated_by: staff.id }).in("id", ids);
  // The removed work stays against the car for its next visit.
  await admin.from("declined_work").insert(drop.filter((l) => l.title.trim()).map((l) => ({ vehicle_id: q.vehicle_id, customer_id: q.customer_id, job_id: q.job_id, quotation_id: q.id, title: l.title, details: `${l.group_label ?? ""}${l.group_label ? " · " : ""}left out of the urgent-only quotation`, amount_aed: l.line_total, declined_at: new Date().toISOString(), created_by: staff.id, updated_by: staff.id })));
  await refreshQuoteTotals(q.id, await getSettings(), staff.id, { reopen: true });
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_urgent_version", `${q.number} v${q.version}: ${staff.display_name} kept the urgent lines only (${drop.length} line${drop.length === 1 ? "" : "s"} and ${parts.length} part${parts.length === 1 ? "" : "s"} removed)`);
  refresh(q.job_id, q.id);
  return { ok: true };
}

export type { QuoteLine };

/** "Add them": the priced parts with no line join the quotation, one line each. */
export async function addMissingParts(quotationId: string): Promise<{ error?: string; ok?: boolean; added?: number }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Only the job's advisor or the owner can change it." };
  if (!q.job_id || !["draft", "pending_owner"].includes(q.status)) return { error: (await refuseIfLocked(q.id, staff.id, "add parts", "quotation page")) ?? "Only a draft can take the parts." };
  const added = await syncMissingParts(q.job_id, q.id, staff.id);
  refresh(q.job_id, q.id);
  return { ok: true, added };
}

/**
 * After "Mark as declined": the car goes to gate-out. Open part requests are cancelled, unordered parts leave the list
 * (Parts are asked about ordered ones), the workshop manager is told to put the car back together, and an optional
 * charge (DIAGNOSIS...) becomes a small tax invoice to be paid before the car leaves. Without one the car goes out free.
 */
export async function declineToGateOut(quotationId: string, formData: FormData) {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) redirect("/dashboard");
  const q = bundle.quotation;
  const back = `/jobs/${q.job_id}/quote/${q.id}`;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) redirect(`${back}?error=${encodeURIComponent("Not allowed.")}`);
  if (q.status !== "declined" || !q.job_id) redirect(`${back}?error=${encodeURIComponent("Only a declined quotation can go to gate-out.")}`);
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, status, is_open, department, gated_in_by").eq("id", q.job_id).maybeSingle();
  if (!job || !job.is_open) redirect(`${back}?error=${encodeURIComponent("This job is closed.")}`);
  const settings = await getSettings();
  const now = new Date().toISOString();
  // The optional charge first, so a bad amount stops here.
  const description = String(formData.get("charge_description") ?? "").trim();
  const amount = Number(String(formData.get("charge_amount") ?? "").replace(",", ".")) || 0;
  let invoiceId: string | null = null;
  let chargeText = "";
  if (description || amount > 0) {
    const inv = await createChargeInvoice(q.job_id, staff, settings, { description: description || "Charge", amount });
    if ("error" in inv) redirect(`${back}?error=${encodeURIComponent(inv.error)}`);
    invoiceId = inv.id;
    chargeText = ` ${inv.number} for ${description || "the charge"} (AED ${inv.total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}) must be paid before the car leaves.`;
  }
  // Open requests are cancelled: Parts stop pricing them. Unordered parts leave the list; ordered ones are put to Parts.
  const { data: openReqs } = await admin.from("part_requests").select("id").eq("job_id", q.job_id).eq("is_active", true).eq("status", "open");
  for (const r of openReqs ?? []) await admin.from("part_requests").update({ status: "rejected", closed_reason: "Quotation declined", removed_at: now, removed_by: staff.id, removed_reason: "Quotation declined", updated_by: staff.id }).eq("id", r.id);
  const { data: parts } = await admin.from("part_items").select("id").eq("job_id", q.job_id).eq("is_active", true);
  await dropParts(q.job_id, (parts ?? []).map((p) => p.id), staff, "declined");
  await admin.from("jobs").update({ status: "ready", stage: "ready", stage_entered_at: now, declined_out_at: now, declined_charge_invoice_id: invoiceId, inspection_fee_due: false, updated_by: staff.id }).eq("id", q.job_id);
  await admin.from("job_events").insert({ job_id: q.job_id, event_type: "status_change", from_status: job.status, to_status: "ready", note: `${q.number} declined: the car goes to gate-out (${staff.display_name}).${chargeText || " No charge: the car leaves free."}`, created_by: staff.id });
  await logQuoteEvent(q.id, q.job_id, staff.id, "declined_to_gate_out", `Proceed to gate-out chosen by ${staff.display_name}${chargeText}`);
  const n = { type: "job_declined_out", title: `${job.job_number} declined: make sure the car is put back together and ready for collection`, body: `The customer declined ${q.number}. Open parts requests are cancelled.${chargeText}`, jobId: q.job_id, href: `/jobs/${q.job_id}` };
  await notifyManagers(job.department ?? null, n);
  if (job.gated_in_by && job.gated_in_by !== staff.id) await notifyStaff([job.gated_in_by], n);
  refresh(q.job_id, q.id);
  redirect(`/jobs/${q.job_id}?message=${encodeURIComponent(`Declined, car going out.${chargeText || " No charge: the car leaves free."}`)}`);
}

/** The commission's amount in AED for the messages, from the quotation's own lines and header. */
async function commissionAmountOf(quotationId: string, kind: "aed" | "percent", value: number): Promise<number> {
  if (kind === "aed") return round2(value);
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return 0;
  const totals = quoteTotals(bundle.lines, bundle.quotation);
  return round2(totals.net * (Math.min(100, Math.max(0, value)) / 100));
}

/**
 * The Commission line of the internal box (under Recovery cost): who and how much. Set by the owner it is approved at
 * once; set or changed by anyone else it waits in amber and the owner is asked ("Approve / Decline / Change amount").
 * Pending commissions count for nothing; removal is logged (and told to the owner when it was already approved).
 * An empty "to" removes it. Works on sent and approved quotations too: a commission never touches the customer's figures.
 */
export async function saveCommission(quotationId: string, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  const isOwner = staff.role_id === "owner";
  const admin = createAdminClient();
  const settings = await getSettings();
  const now = new Date().toISOString();
  const to = String(formData.get("to") ?? "").trim().slice(0, 80);
  const plate = bundle.vehicle ? formatPlate(bundle.vehicle) : bundle.job?.job_number ?? q.number;
  if (!to) {
    if (!q.commission_to) return { ok: true };
    const wasApproved = q.commission_status === "approved" || (q.commission_status === null && !!q.commission_to);
    await admin.from("quotations").update({ commission_to: null, commission_kind: null, commission_value: null, commission_status: null, commission_set_by: staff.id, commission_set_at: now, commission_decided_by: null, commission_decided_at: null, commission_decision_note: null, updated_by: staff.id }).eq("id", q.id);
    await refreshQuoteTotals(q.id, settings, staff.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "commission_removed", `${q.number}: the commission for ${q.commission_to} was removed by ${staff.display_name}`);
    if (wasApproved && !isOwner) await notifyRoles(["owner"], { type: "commission_approval", title: `Commission removed on ${plate}`, body: `${staff.display_name} removed the approved commission for ${q.commission_to} on ${q.number}.`, jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}/quote/${q.id}` : `/estimates/${q.id}` });
    refresh(q.job_id, q.id);
    return { ok: true };
  }
  const kind = formData.get("kind") === "percent" ? "percent" : "aed";
  const v = Number(String(formData.get("value") ?? "").replace(",", "."));
  if (!Number.isFinite(v) || v <= 0) return { error: "Enter the amount: AED, or a percentage of the total before VAT." };
  const value = kind === "percent" ? Math.min(100, round2(v)) : round2(v);
  const status = isOwner ? "approved" : "pending";
  // ONE commission per job: setting it here supersedes any commission sitting on another quotation of
  // the same job (an older number, a leftover) - a job never carries two.
  if (q.job_id) {
    const { data: others } = await admin.from("quotations").select("id, number, version, commission_to, commission_paid_at").eq("job_id", q.job_id).eq("is_active", true).neq("id", q.id).not("commission_to", "is", null).or("commission_status.is.null,commission_status.neq.superseded");
    for (const o of others ?? []) {
      if (o.commission_paid_at) return { error: `A commission on this job was already paid (${o.number} v${o.version}, to ${o.commission_to}). One commission per job; ask the owner if it must change.` };
      await admin.from("quotations").update({ commission_to: null, commission_kind: null, commission_value: null, commission_aed: 0, commission_status: "superseded", commission_decided_by: null, commission_decided_at: null, commission_decision_note: null, updated_by: staff.id }).eq("id", o.id);
      await logQuoteEvent(o.id, q.job_id, staff.id, "commission_superseded", `${o.number} v${o.version}: the commission for ${o.commission_to} was replaced by the one on ${q.number} v${q.version} (one commission per job)`);
    }
  }
  const { error } = await admin.from("quotations").update({ commission_to: to, commission_kind: kind, commission_value: value, commission_status: status, commission_set_by: staff.id, commission_set_at: now, commission_decided_by: isOwner ? staff.id : null, commission_decided_at: isOwner ? now : null, commission_decision_note: null, updated_by: staff.id }).eq("id", q.id);
  if (error) return { error: error.message };
  const people = ((settings.commission_people ?? []) as string[]).map(String);
  if (!people.includes(to)) await admin.from("settings").upsert({ key: "commission_people", value: [...people, to], label: "Commission: people", description: "People we pay commission to, offered as one-tap choices in the internal box of a quotation." }, { onConflict: "key" });
  await refreshQuoteTotals(q.id, settings, staff.id);
  const amount = await commissionAmountOf(q.id, kind, value);
  await logQuoteEvent(q.id, q.job_id, staff.id, "commission_set", `${q.number}: commission for ${to} (${kind === "percent" ? `${value}% = ${aed(amount)}` : aed(amount)}) ${isOwner ? `set and approved by ${staff.display_name}` : `set by ${staff.display_name}, waiting for the owner`}`);
  if (!isOwner) await notifyRoles(["owner"], { type: "commission_approval", title: `Commission for ${to}, ${aed(amount)} on ${plate} (${bundle.job?.job_number ?? q.number})`, body: `Asked by ${staff.display_name} on ${q.number}. Approve, decline or change the amount on the quotation.`, jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}/quote/${q.id}` : `/estimates/${q.id}` });
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** The owner's answer on a waiting commission: Approve (it starts counting) or Decline (removed, with his note). */
export async function decideCommission(quotationId: string, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const staff = await requirePermission("approveQuotes");
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  if (q.commission_status !== "pending" || !q.commission_to) return { error: "No commission is waiting on this quotation." };
  const decision = String(formData.get("decision") ?? "");
  const note = blankToNull(formData.get("note"));
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const amount = await commissionAmountOf(q.id, q.commission_kind ?? "aed", Number(q.commission_value) || 0);
  if (decision === "approve") {
    await admin.from("quotations").update({ commission_status: "approved", commission_decided_by: staff.id, commission_decided_at: now, commission_decision_note: note, updated_by: staff.id }).eq("id", q.id);
    await refreshQuoteTotals(q.id, await getSettings(), staff.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "commission_approved", `${q.number}: the owner approved the commission for ${q.commission_to} (${aed(amount)})${note ? `: ${note}` : ""}`);
    if (q.commission_set_by) await notifyStaff([q.commission_set_by], { type: "commission_approval", title: `Commission approved: ${q.commission_to}, ${aed(amount)}`, body: `${q.number}. It now counts in the job's cost and the monthly list.`, jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}/quote/${q.id}` : `/estimates/${q.id}` });
    refresh(q.job_id, q.id);
    return { ok: true };
  }
  await admin.from("quotations").update({ commission_to: null, commission_kind: null, commission_value: null, commission_status: "declined", commission_decided_by: staff.id, commission_decided_at: now, commission_decision_note: note, updated_by: staff.id }).eq("id", q.id);
  await refreshQuoteTotals(q.id, await getSettings(), staff.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "commission_declined", `${q.number}: the owner declined the commission for ${q.commission_to} (${aed(amount)})${note ? `: ${note}` : ""}`);
  if (q.commission_set_by) await notifyStaff([q.commission_set_by], { type: "commission_approval", title: `Commission declined: ${q.commission_to}`, body: `${q.number}${note ? `. Owner: ${note}` : ""}`, jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}/quote/${q.id}` : `/estimates/${q.id}` });
  refresh(q.job_id, q.id);
  return { ok: true };
}

/**
 * The customer name of a part (1.5, 21 October 2026): the advisor or the owner rename what the
 * customer reads on the quotation, proforma and invoice; the supplier name (and the part number)
 * never change, so LPOs, the parts pages and the stickers stay as Parts wrote them. Locked the
 * moment a quotation carrying the part is approved.
 */
export async function setCustomerPartName(partId: string, formData: FormData): Promise<{ error?: string; ok?: boolean; title?: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "Viewing only." };
  const role = staff.role_id as RoleId;
  if (!(role === "owner" || role === "service_advisor")) return { error: "The advisor or the owner rename a part for the customer." };
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const admin = createAdminClient();
  const { data: part } = await admin.from("part_items").select("id, job_id, description, customer_name").eq("id", partId).maybeSingle();
  if (!part) return { error: "Part not found." };
  const { data: approvedLines } = await admin.from("quotation_lines").select("id, quotation:quotations!inner(status)").eq("part_item_id", partId).eq("is_active", true).eq("quotation.status", "approved").limit(1);
  if ((approvedLines ?? []).length) return { error: "The customer approved this part: its name is locked. Revise the quotation to change it." };
  const value = name || null;
  await admin.from("part_items").update({ customer_name: value, updated_by: staff.id }).eq("id", partId);
  const title = value ?? String(part.description ?? "");
  const { data: lines } = await admin.from("quotation_lines").select("id, quotation:quotations!inner(status, job_id)").eq("part_item_id", partId).eq("is_active", true).in("quotation.status", ["draft", "pending_owner", "sent", "opened", "urgent_requested"]);
  for (const l of (lines ?? []) as { id: string }[]) await admin.from("quotation_lines").update({ title, updated_by: staff.id }).eq("id", l.id);
  if (part.job_id) {
    await admin.from("job_events").insert({ job_id: part.job_id, event_type: "part_renamed", note: `${String(part.description ?? "").toUpperCase()} shows to the customer as ${title.toUpperCase()} (${staff.display_name})`, created_by: staff.id });
    refresh(part.job_id as string);
  }
  return { ok: true, title };
}
