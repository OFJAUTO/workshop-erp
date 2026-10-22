"use server";

import { redirect } from "next/navigation";
import { jobAdvisorIds as advisorsInCharge } from "@/lib/notifications";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull, normalisePhone } from "@/lib/format";
import { afterBodyshopHandover, signoffState } from "@/lib/bodyshop";
import { SIGNOFF_LABELS } from "@/lib/bodyshop-kinds";
import { formValues, type FormState } from "@/lib/form-state";
import { jobBalance } from "@/lib/invoice-data";
import { STATUS_LABELS, type JobStatus, dubaiDate } from "@/lib/jobs";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { closeJob } from "@/lib/close-job";
import { createTrip, rememberDriver } from "@/lib/delivery";
import { isMapLink } from "@/lib/recovery";

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/gate-out`);
  revalidatePath("/dashboard");
  revalidatePath("/jobs");
  revalidatePath("/calendar");
}

async function advisorIds(jobId: string, gatedInBy: string | null) {
  void gatedInBy;
  return advisorsInCharge(jobId);
}

/**
 * Gate-out: how the car leaves, the checks before release (balance, keys, dash cam, old parts),
 * the handover. Customer collections close the job; a delivery stamps "Left workshop" and closes
 * on "Delivered".
 */
export async function gateOutJob(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("gateOut");
  const role = staff.role_id as RoleId;
  const values = formValues(formData);
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, status, is_open, job_number, gated_in_by, customer_id, declined_out_at").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is already closed.", values };
  if (job.status === "in_delivery") return { error: "The car has left for delivery. Mark it delivered instead.", values };
  // Gate-out comes after QC, the wash and the invoice. Only the owner may go through earlier, and it is written down.
  if (!["ready", "pending_payment"].includes(job.status)) {
    if (role !== "owner") return { error: "This car is not ready to leave yet: QC, the wash and the invoice come first.", values };
    await admin.from("job_events").insert({ job_id: jobId, event_type: "override", from_status: job.status, note: `Gated out by ${staff.display_name}, ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date())}, while the car was still at ${STATUS_LABELS[job.status as JobStatus]}. Reason: owner override, before QC, the wash and the invoice`, created_by: staff.id });
  }
  // A bodyshop car leaves only after the release sign-off (the owner signs on behalf of anyone on the bodyshop page).
  const { data: jd } = await admin.from("jobs").select("department").eq("id", jobId).maybeSingle();
  const bodyshopCar = jd?.department === "bodyshop";
  if (bodyshopCar) {
    const st = await signoffState(jobId);
    if (st.hasStages && !st.complete) return { error: `Release sign-off missing: waiting on ${st.waitingOn.map((k) => SIGNOFF_LABELS[k]).join(", ")}. Sign it on the bodyshop page.`, values };
  }
  const { data: gi } = await admin.from("gate_ins").select("keys_count, keys_keychain, dash_cam, old_parts_return").eq("job_id", jobId).maybeSingle();
  if (!gi) return { error: "No gate-in record found.", values };
  const method = String(formData.get("leave_method") ?? "");
  if (!["customer", "customer_driver", "recovery"].includes(method)) return { error: "Choose how the car leaves.", values };
  let collector = blankToNull(formData.get("collector_name"));
  let collectorPhone = blankToNull(formData.get("collector_phone"));
  let contactId: string | null = null;
  let savedDriver = false;
  if (method === "customer_driver") {
    const choice = String(formData.get("collector_contact_id") ?? "new");
    if (choice !== "new") {
      const { data: c } = await admin.from("customer_contacts").select("id, name, phone, customer_id").eq("id", choice).eq("is_active", true).maybeSingle();
      if (!c || c.customer_id !== job.customer_id) return { error: "Pick the driver again.", values };
      contactId = c.id;
      collector = c.name;
      collectorPhone = c.phone ?? collectorPhone;
    } else {
      if (!collector) return { error: "Enter the driver's name.", values };
      if (!collectorPhone) return { error: "Enter the driver's phone number.", values };
      const phone = normalisePhone(collectorPhone);
      if (phone.replace(/\D/g, "").length < 7) return { error: "Enter the driver's phone number.", values };
      // Saved on the customer as a driver for next time (a contact with the same phone is reused).
      const { data: existing } = job.customer_id ? await admin.from("customer_contacts").select("id").eq("customer_id", job.customer_id).eq("phone", phone).limit(1) : { data: [] };
      if (existing?.[0]) contactId = existing[0].id;
      else if (job.customer_id) {
        const { data: ins } = await admin.from("customer_contacts").insert({ customer_id: job.customer_id, name: collector, phone, relationship: "Driver", can_approve: false, created_by: staff.id, updated_by: staff.id }).select("id").maybeSingle();
        contactId = ins?.id ?? null;
        savedDriver = !!ins;
      }
      collectorPhone = phone;
    }
  } else if (collectorPhone) {
    collectorPhone = normalisePhone(collectorPhone);
  }
  if (method !== "recovery" && !collector) return { error: "Enter the name of the person collecting the car.", values };
  if (method !== "recovery" && formData.get("handover_confirmed") !== "on") return { error: "Tick that the handover is confirmed with the collecting person.", values };

  // Keys: one tick for the gate-in's count ("1 key handed back"); "Different number of keys?" opens the choice with a reason.
  const sameAsGateIn = formData.get("keys_ok") === "on";
  const keysReturned = sameAsGateIn ? String(gi.keys_count) : String(formData.get("keys_returned") ?? "");
  const keychain = sameAsGateIn ? !!gi.keys_keychain : formData.get("keychain_returned") === "yes";
  if (sameAsGateIn && gi.keys_keychain && formData.get("keychain_ok") !== "on") return { error: "Tick that the keychain was handed back.", values };
  if (!sameAsGateIn && formData.get("keys_confirmed") !== "yes") return { error: `Tick "${gi.keys_count} key${gi.keys_count === 1 ? "" : "s"} handed back", or open "Different number of keys?".`, values };
  if (!/^\d{1,2}$/.test(keysReturned)) return { error: "Enter the number of keys handed back.", values };
  const keysMatch = Number(keysReturned) === gi.keys_count && keychain === gi.keys_keychain;
  let overrideBy: string | null = null;
  const overrideReason = String(formData.get("override_reason") ?? "").trim();
  if (!keysMatch) {
    if (!can(role, "overrideKeys")) return { error: "Keys do not match the gate-in record. Only the owner or workshop manager can override, with a reason.", values };
    if (overrideReason.length < 5) return { error: "Keys do not match. Write the reason for the override.", values };
    overrideBy = staff.id;
  }
  const dashCam = gi.dash_cam ? formData.get("dash_cam_reconnected") === "on" : null;
  if (gi.dash_cam && !dashCam) return { error: "Tick that the dash cam has been reconnected.", values };
  const oldParts = gi.old_parts_return ? formData.get("old_parts_handed") === "on" : null;
  if (gi.old_parts_return && !oldParts) return { error: "Tick that the old parts were handed over; the customer asked for them.", values };

  // Balance. Credit terms (B2B, set by the owner on the customer): the balance is due within the agreed days instead.
  const bal = await jobBalance(jobId);
  let releaseBy: string | null = null;
  let releaseReason = String(formData.get("release_reason") ?? "").trim();
  const { data: creditJob } = await createAdminClient().from("jobs").select("customer_id").eq("id", jobId).maybeSingle();
  const { data: creditCust } = creditJob?.customer_id ? await createAdminClient().from("customers").select("credit_terms_days").eq("id", creditJob.customer_id).maybeSingle() : { data: null };
  const creditDays = Number(creditCust?.credit_terms_days) || 0;
  if (bal.state === "no_invoice" && job.declined_out_at) {
    // The customer declined the quotation and no charge was added: the car leaves free, written down.
    releaseBy = staff.id;
    releaseReason = "Declined quotation, no charge: the car leaves free";
  } else if (bal.state === "no_invoice") {
    if (!can(role, "approveRelease")) return { error: "No invoice has been issued for this job. Accounts must issue it before the car leaves.", values };
    if (releaseReason.length < 5) return { error: "No invoice issued yet. Write the reason to release without one (logged).", values };
    releaseBy = staff.id;
  } else if (bal.balance > 0 && creditDays > 0) {
    releaseBy = staff.id;
    releaseReason = `Credit terms: ${creditDays} days, balance AED ${bal.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })} due by ${new Date(Date.now() + creditDays * 86400000).toISOString().slice(0, 10)}`;
  } else if (bal.balance > 0) {
    if (!can(role, "approveRelease")) return { error: `Balance due AED ${bal.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })}. Only the owner or accounts can approve the release.`, values };
    if (releaseReason.length < 5) return { error: "Write the reason for releasing with a balance due (logged).", values };
    releaseBy = staff.id;
  }

  // Recovery: the company, the driver (one tap or a new one, saved), the customer's pin, the day and the time.
  const companyChoice = String(formData.get("delivery_company_choice") ?? "our_truck");
  const typedCompany = blankToNull(formData.get("delivery_company"));
  const company = companyChoice === "our_truck" ? null : companyChoice === "other" ? typedCompany : companyChoice;
  if (method === "recovery" && companyChoice === "other" && !company) return { error: "Enter the recovery company's name.", values };
  let driverName = blankToNull(formData.get("delivery_driver"));
  let driverPhone = blankToNull(formData.get("driver_phone"));
  let truckPlate = blankToNull(formData.get("truck_plate"));
  let driverId: string | null = null;
  const locationUrl = blankToNull(formData.get("location_url"));
  const locationDetails = blankToNull(formData.get("location_details"));
  // "Today" is the default chip: an untouched form means today in Dubai.
  const deliveryDate = blankToNull(formData.get("delivery_date")) ?? dubaiDate(new Date());
  const slotChoice = String(formData.get("delivery_slot") ?? "afternoon");
  const slotTime = blankToNull(formData.get("slot_time"));
  const slot = slotChoice === "exact" ? slotTime : slotChoice;
  if (method === "recovery") {
    const choice = String(formData.get("driver_choice") ?? "new");
    if (choice !== "new") {
      const { data: d } = await admin.from("recovery_drivers").select("id, name, phone, truck_plate").eq("id", choice).eq("is_active", true).maybeSingle();
      if (!d) return { error: "Pick the driver again.", values };
      driverId = d.id;
      driverName = d.name;
      driverPhone = d.phone ?? driverPhone;
      truckPlate = d.truck_plate ?? truckPlate;
    } else {
      if (!driverName) return { error: "Enter the driver's name.", values };
      driverId = await rememberDriver({ name: driverName, phone: driverPhone, truckPlate, company }, staff.id);
    }
    if (!locationUrl) return { error: "Paste the customer's location pin (the map link).", values };
    if (!isMapLink(locationUrl)) return { error: "That is not a map link. Paste the pin the customer sent on WhatsApp or Google Maps.", values };
    if (slotChoice === "exact" && !slotTime) return { error: "Enter the exact time, or pick Morning, Afternoon or Evening.", values };
  }
  const delivery = method === "recovery"
    ? {
        delivery_address: locationDetails ?? "Map pin",
        delivery_at: null,
        delivery_by: companyChoice === "our_truck" ? "our_truck" : "outside",
        delivery_company: company,
        delivery_driver: driverName,
        left_at: new Date().toISOString(),
        left_by: staff.id,
      }
    : {};

  const { error } = await admin.from("gate_outs").upsert(
    {
      job_id: jobId,
      leave_method: method,
      collector_name: collector,
      collector_phone: collectorPhone,
      collector_contact_id: contactId,
      handover_confirmed: method !== "recovery",
      keys_returned: Number(keysReturned),
      keychain_returned: keychain,
      keys_match: keysMatch,
      keys_override_by: overrideBy,
      keys_override_reason: overrideBy ? overrideReason : null,
      dash_cam_reconnected: dashCam,
      old_parts_handed: oldParts,
      balance_due_aed: bal.balance,
      release_approved_by: releaseBy,
      release_reason: releaseBy ? releaseReason : null,
      notes: null,
      ...delivery,
      created_by: staff.id,
      updated_by: staff.id,
    },
    { onConflict: "job_id" },
  );
  if (error) return { error: error.message, values };
  if (savedDriver) await admin.from("job_events").insert({ job_id: jobId, event_type: "note", note: `Driver saved on the customer: ${collector}, ${collectorPhone}`, created_by: staff.id });
  if (method === "recovery" && companyChoice === "other" && company) {
    // A new recovery company is remembered for next time (Settings > Recovery companies).
    const list = ((await getSettings()).recovery_companies ?? []) as string[];
    if (!list.some((c) => c.toLowerCase() === company.toLowerCase())) await admin.from("settings").update({ value: [...list, company], updated_by: staff.id }).eq("key", "recovery_companies");
  }
  if (bodyshopCar) await afterBodyshopHandover(jobId, blankToNull(formData.get("final_check_date")), staff);
  if (releaseBy) await admin.from("job_events").insert({ job_id: jobId, event_type: "override", note: `Release approved by ${staff.display_name} with ${bal.state === "no_invoice" ? "no invoice" : `AED ${bal.balance.toLocaleString("en-GB")} due`}: ${releaseReason}`, created_by: staff.id });
  if (overrideBy) {
    await admin.from("job_events").insert({ job_id: jobId, event_type: "override", note: `Keys override by ${staff.display_name}: ${overrideReason}`, created_by: staff.id });
    // A different key count at gate-out: the owner hears it at once.
    await notifyRoles(["owner"], { type: "release_approval", title: `Keys differ at gate-out · ${job.job_number}`, body: `Gate-in recorded ${gi.keys_count} key${gi.keys_count === 1 ? "" : "s"}${gi.keys_keychain ? " with keychain" : ""}; handed back ${keysReturned}${keychain ? " with keychain" : ""}. ${staff.display_name}: ${overrideReason}`, jobId, href: `/jobs/${jobId}` });
  }

  if (method === "recovery") {
    await createTrip({ jobId, kind: "delivery", company, driverId, driverName, driverPhone, truckPlate, locationUrl, locationDetails, date: deliveryDate, slot, by: staff.id });
    await admin.from("jobs").update({ status: "in_delivery", stage: "ready" }).eq("id", jobId);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: job.status, to_status: "in_delivery", note: `Left the workshop for delivery (${delivery.delivery_by === "outside" ? delivery.delivery_company ?? "outside recovery" : "our truck"}, driver ${delivery.delivery_driver}) to ${delivery.delivery_address}, stamped by ${staff.display_name}`, created_by: staff.id });
    const ids = await advisorIds(jobId, job.gated_in_by);
    await notifyStaff(ids, { type: "delivery", title: `Left workshop for delivery · ${job.job_number}`, body: "Send the details to the driver from the delivery panel; the job closes itself when he presses Delivered.", jobId, href: `/jobs/${jobId}/gate-out` });
    refresh(jobId);
    redirect(`/jobs/${jobId}/gate-out?message=${encodeURIComponent("Stamped: left the workshop. Now press Send to driver.")}`);
  }
  await closeJob(jobId, staff.id, staff.display_name, `${method === "customer" ? "customer collected" : "customer's driver collected"} (${collector})`);
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Gated out. The job is closed.")}`);
}


/** The advisor records the follow-up call. */
export async function followUpDone(jobId: string) {
  const staff = await requirePermission("sendApproval");
  const admin = createAdminClient();
  await admin.from("jobs").update({ followup_done_at: new Date().toISOString() }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "followup", note: `Follow-up done by ${staff.display_name}`, created_by: staff.id });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Follow-up recorded.")}`);
}

/** Tells the owner that a release needs approval (balance due or no invoice). */
export async function askReleaseApproval(jobId: string) {
  const staff = await requirePermission("gateOut");
  const bal = await jobBalance(jobId);
  const { data: job } = await createAdminClient().from("jobs").select("job_number").eq("id", jobId).maybeSingle();
  await notifyRoles(["owner", "accounts"], { type: "release_approval", title: `Release approval needed · ${job?.job_number ?? ""}`, body: bal.state === "no_invoice" ? `${staff.display_name} wants to release the car with no invoice issued.` : `${staff.display_name} wants to release the car with AED ${bal.balance.toLocaleString("en-GB")} due.`, jobId, href: `/jobs/${jobId}/gate-out` });
  redirect(`/jobs/${jobId}/gate-out?message=${encodeURIComponent("The owner and accounts have been asked to approve the release.")}`);
}

/** Loose items leave one by one: tick what goes, name who took it. The job closes when the last item has gone. */
export async function collectItems(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("gateOut");
  const role = staff.role_id as RoleId;
  const values = formValues(formData);
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, status, is_open, job_number, gated_in_by, job_kind").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is already closed.", values };
  if (job.job_kind !== "loose") return { error: "This job has a car: use the gate-out form.", values };
  const ids = formData.getAll("item").map(String).filter(Boolean);
  if (!ids.length) return { error: "Tick at least one item.", values };
  const collector = blankToNull(formData.get("collector_name"));
  if (!collector) return { error: "Enter the name of the person collecting.", values };
  if (formData.get("handover_confirmed") !== "on") return { error: "Tick that the handover is confirmed with the collecting person.", values };
  if (!["ready", "pending_payment"].includes(job.status)) {
    if (role !== "owner") return { error: "The items are not ready to leave yet: QC and the invoice come first.", values };
    await admin.from("job_events").insert({ job_id: jobId, event_type: "override", from_status: job.status, note: `Items released by ${staff.display_name} while the job was still at ${STATUS_LABELS[job.status as JobStatus]} (owner override)`, created_by: staff.id });
  }
  const bal = await jobBalance(jobId);
  const releaseReason = String(formData.get("release_reason") ?? "").trim();
  const blocked = bal.state === "no_invoice" || bal.balance > 0;
  if (blocked) {
    if (!can(role, "approveRelease")) return { error: bal.state === "no_invoice" ? "No invoice has been issued for this job. Accounts must issue it before the items leave." : `Balance due AED ${bal.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })}. Only the owner or accounts can approve the release.`, values };
    if (releaseReason.length < 5) return { error: "Write the reason for releasing with the balance open (logged).", values };
    await admin.from("job_events").insert({ job_id: jobId, event_type: "override", note: `Release approved by ${staff.display_name} with ${bal.state === "no_invoice" ? "no invoice" : `AED ${bal.balance.toLocaleString("en-GB")} due`}: ${releaseReason}`, created_by: staff.id });
  }
  const now = new Date().toISOString();
  const { data: items } = await admin.from("job_items").select("id, item_type, description, quantity, collected_at").eq("job_id", jobId).eq("is_active", true);
  const all = items ?? [];
  const leaving = all.filter((i) => ids.includes(i.id) && !i.collected_at);
  if (!leaving.length) return { error: "Those items have already been collected.", values };
  await admin.from("job_items").update({ collected_at: now, collected_by: staff.id, collector_name: collector, updated_by: staff.id }).in("id", leaving.map((i) => i.id));
  const left = all.filter((i) => !i.collected_at && !ids.includes(i.id)).length;
  const names = leaving.map((i) => `${Number(i.quantity) > 1 ? `${i.quantity} × ` : ""}${i.item_type}${i.description ? ` (${i.description})` : ""}`).join(", ");
  await admin.from("gate_outs").upsert({ job_id: jobId, leave_method: "customer", collector_name: collector, handover_confirmed: true, keys_returned: 0, keychain_returned: false, keys_match: true, balance_due_aed: bal.balance, release_approved_by: blocked ? staff.id : null, release_reason: blocked ? releaseReason : null, notes: blankToNull(formData.get("notes")), created_by: staff.id, updated_by: staff.id }, { onConflict: "job_id" });
  if (left === 0) {
    await closeJob(jobId, staff.id, staff.display_name, `last items collected by ${collector}: ${names}`);
    refresh(jobId);
    redirect(`/jobs/${jobId}?message=${encodeURIComponent("All items collected. The job is closed.")}`);
  }
  await admin.from("job_events").insert({ job_id: jobId, event_type: "gate_out", note: `Collected by ${collector}: ${names}. ${left} item${left === 1 ? "" : "s"} still with us.`, created_by: staff.id });
  refresh(jobId);
  redirect(`/jobs/${jobId}/gate-out?message=${encodeURIComponent(`${leaving.length} item${leaving.length === 1 ? "" : "s"} collected. ${left} still with us.`)}`);
}
