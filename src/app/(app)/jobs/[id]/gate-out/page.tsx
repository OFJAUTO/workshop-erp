import { DamageSection } from "@/components/DamageSection";
import { RecordPaymentButton } from "@/components/RecordPaymentHost";
import { FixIt } from "@/components/FixIt";
import { WarrantyFixPanel } from "@/components/WarrantyFixPanel";
import { remindToFix } from "../../fix-actions";
import { loadCarDamage } from "@/lib/damage-data";
import { VinCopy } from "@/components/VinCopy";
import { createAdminClient } from "@/lib/supabase/admin";
import { CarHeaderThumb } from "@/components/CarHeaderThumb";
import { notFound, redirect } from "next/navigation";
import { Button, Card, DescriptionList, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { STATUS_LABELS } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { reasonsFor } from "@/lib/reasons";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { jobBalance } from "@/lib/invoice-data";
import { approvedKinds, signoffState } from "@/lib/bodyshop";
import { SIGNOFF_LABELS, addDaysIso } from "@/lib/bodyshop-kinds";
import { dubaiDate } from "@/lib/jobs";
import { askReleaseApproval, collectItems, gateOutJob } from "../../gate-out-actions";
import { advisorMarkDelivered } from "../../delivery-actions";
import { activeDeliveryTrip, driverMessageFor, loadDrivers, lastPinOf } from "@/lib/delivery";
import { onTheWayMessage } from "@/lib/recovery";
import { greetingNameOf } from "@/lib/messages";
import { DeliveryPanel } from "./DeliveryPanel";
import { shortFor } from "@/lib/short-links";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { loadJobItems } from "@/lib/loose-items";
import { CollectItemsForm } from "./CollectItemsForm";
import { GateOutForm } from "./GateOutForm";
import { readingOf, type MileageUnit } from "@/lib/mileage";
import { gateOutMileageReady } from "@/lib/schema-ready";
import { JOB_FILE_SELECT, signJobFiles, type JobFileRow } from "@/lib/work-data";
import { refuseRecord } from "@/lib/refusal";

export const dynamic = "force-dynamic";

/** Money on screen: two decimals and thousands separators. */
const m = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function GateOutPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("gateOut");
  const { id } = await params;
  const { message, error } = await searchParams;
  // 11 November 2026 (Section 11): the gate-in login uses the same form, read through the server, with no amounts.
  const gateInRole = staff.role_id === "gate_in";
  const supabase = gateInRole ? createAdminClient() : await createClient();
  const [card, bal, settings] = await Promise.all([loadJobCard(supabase, id), jobBalance(id), getSettings()]);
  if (!card) return refuseRecord("job", id);
  if (!card.job.is_open) redirect(`/jobs/${id}`);
  // 9 November 2026: a cheque not cleared or a transfer not confirmed holds the car (the owner may release it, logged).
  const { loadBankWaiting } = await import("@/lib/bank-posting");
  const bankHold = await loadBankWaiting({ jobIds: [id] });
  const loose = card.job.job_kind === "loose";
  if (!loose && !card.gateIn) notFound();
  const g = card.gateIn;
  const items = loose ? await loadJobItems(id) : [];
  const role = staff.role_id as RoleId;
  const keysPhotos = card.media.filter((m) => m.kind === "keys_photo_front" || m.kind === "keys_photo_back" || m.kind === "keys_photo");
  const job = card.job;
  const { data: creditCust } = job.customer_id ? await createAdminClient().from("customers").select("credit_terms_days").eq("id", job.customer_id).maybeSingle() : { data: null };
  const creditDays = Number(creditCust?.credit_terms_days) || 0;
  // Drivers and other people saved on the customer: one tap at "Customer's driver collects".
  const { data: contactRows } = job.customer_id ? await createAdminClient().from("customer_contacts").select("id, name, phone, relationship").eq("customer_id", job.customer_id).eq("is_active", true).order("name") : { data: [] };
  const contacts = (contactRows ?? []) as { id: string; name: string; phone: string | null; relationship: string | null }[];
  const { data: declinedRow } = await createAdminClient().from("jobs").select("declined_out_at").eq("id", id).maybeSingle();
  // The delivery pieces: the saved drivers, the returning customer's last pin, and the live trip once stamped out.
  const [drivers, lastPin, trip] = await Promise.all([loadDrivers(), lastPinOf(job.customer_id), activeDeliveryTrip(id)]);
  const driverText = trip ? await driverMessageFor(trip) : "";
  const { data: custRow } = job.customer_id ? await createAdminClient().from("customers").select("full_name, company_name, phone").eq("id", job.customer_id).maybeSingle() : { data: null };
  const customerText = trip ? onTheWayMessage(String(settings.whatsapp_on_the_way_template ?? ""), { name: greetingNameOf(custRow), car: vehicleTitle(card.vehicle), truckPlate: trip.truck_plate ?? "", driverName: trip.driver_name ?? "", driverMobile: trip.driver_phone ?? "" }) : "";
  const declinedOut = !!declinedRow?.declined_out_at;
  // 30 October 2026: the final reading against the gate-in one, in the car's own unit, and the cluster photo already taken.
  const mileageUnit: MileageUnit = g?.mileage_unit === "mi" ? "mi" : "km";
  const { data: odoRows } = loose ? { data: [] } : await createAdminClient().from("job_files").select(JOB_FILE_SELECT).eq("job_id", id).eq("kind", "odometer_out").is("removed_at", null).order("created_at", { ascending: false }).limit(1);
  const odo = ((odoRows ?? []) as unknown as JobFileRow[])[0] ?? null;
  const odoUrl = odo ? (await signJobFiles([odo.storage_path]))[odo.storage_path] ?? null : null;
  const mileage = loose || !g || !(await gateOutMileageReady()) ? null : { unit: mileageUnit, inReading: readingOf(g.mileage, g.mileage_miles, mileageUnit), alertKm: Number(settings.mileage_alert_km) || 30, photo: odo ? { id: odo.id, path: odo.storage_path, url: odoUrl, caption: odo.caption, contentType: odo.content_type } : null };
  const blocked = ((bal.state === "no_invoice" && !declinedOut) || bal.balance > 0) && !(bal.state !== "no_invoice" && bal.balance > 0 && creditDays > 0);
  // Bodyshop: the sign-off state, and the final check visit for a PPF car (7 to 14 days, the Settings default).
  const bodyshop = job.department === "bodyshop";
  const signoff = bodyshop ? await signoffState(id) : null;
  // 13 November 2026 (Section 5): the warranty card must be complete before the car leaves (a warning, never a block).
  const warrantyGaps = bodyshop ? ((await (await import("@/lib/warranty-data")).warrantyCardOf(id, settings).catch(() => null))?.missing ?? []) : [];
  const kinds = bodyshop ? (await approvedKinds(id)).kinds : [];
  // 13 November 2026 (Section 4): who may fix each warning here, and the fix (or "Remind …") beside it.
  const mayWriteWarranty = !staff.viewingAs && (role === "owner" || can(role, "leadSection") || (role === "workshop_manager" && ["bodyshop", "paint", "ppf_tint", "detailing"].includes(staff.department_id ?? "")));
  const mayPay = can(role, "recordPayments") && !staff.viewingAs;
  const fixPay = mayPay
    ? <RecordPaymentButton jobId={id} label="Record payment" />
    : <FixIt hook="pay" tone="amber" message="Only accounts or the owner record the payment." remind={{ label: "Remind accounts", action: remindToFix.bind(null, id, "the payment before the car leaves", "accounts", `/jobs/${id}/invoice`) }} />;
  const fixSignoff = <FixIt hook="signoff" tone="amber" message="The bodyshop sign-off is signed by the team leaders, or released by the owner." remind={{ label: "Remind the bodyshop manager", action: remindToFix.bind(null, id, "the bodyshop release sign-off", "bodyshop_manager", `/bodyshop/${id}`) }} />;
  // A server page: the date is read once.
  const today = dubaiDate();
  const finalCheck = bodyshop && (kinds.includes("ppf") || kinds.includes("coloured_ppf")) ? { defaultDate: addDaysIso(today, Math.min(14, Math.max(7, Number(settings.bodyshop_final_check_days) || 10))), min: addDaysIso(today, 7), max: addDaysIso(today, 14) } : null;

  return (
    <>
      <PageHeader picture={<CarHeaderThumb vehicleId={job.vehicle_id} />} title={`Gate out · ${formatPlate(card.vehicle)}`} subtitle={<span className="flex flex-wrap items-center gap-2"><span>{vehicleTitle(card.vehicle)} · {job.job_number} · {declinedOut ? "Declined, car going out" : STATUS_LABELS[job.status]}</span>{!loose ? <VinCopy vin={card.vehicle.vin} /> : null}</span>} actions={<LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">Job card</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {warrantyGaps.length ? (
        <div data-warranty-incomplete>
          {/* 13 November 2026 (Section 4, J-00991): the fix is here - "Enter details" opens the same fields as the bodyshop page. */}
          <FixIt
            hook="warranty"
            message={<>Warranty card incomplete: {warrantyGaps.join(", ")} missing. Fill it before the customer leaves.</>}
            fixLabel={mayWriteWarranty ? "Enter details" : undefined}
            remind={mayWriteWarranty ? null : { label: "Remind the bodyshop manager", action: remindToFix.bind(null, id, `warranty card details (${warrantyGaps.join(", ")})`, "bodyshop_manager", `/jobs/${id}/gate-out`) }}
          >
            {mayWriteWarranty ? <WarrantyFixPanel jobId={id} back={`/jobs/${id}/gate-out`} /> : null}
          </FixIt>
        </div>
      ) : null}
      {job.status !== "ready" && job.status !== "pending_payment" && job.status !== "in_delivery" ? <Notice tone="info">{loose ? "The items are" : "This car is"} not marked ready yet ({STATUS_LABELS[job.status]}). Gate-out is still allowed and will be logged.</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          {job.status === "in_delivery" && trip ? (
            <DeliveryPanel
              jobId={id}
              trip={{ driverName: trip.driver_name, driverPhone: trip.driver_phone, truckPlate: trip.truck_plate, sentAt: trip.sent_at, loadedAt: trip.loaded_at, leftAt: card.gateOut?.created_at ?? trip.created_at }}
              driverText={driverText}
              customerText={customerText}
              customerPhone={custRow?.phone ?? ""}
              shortLink={trip.token ? await shortFor(`${PRODUCTION_SITE_URL}/drive/${trip.token}`, "drive") : null}
              markDeliveredAction={advisorMarkDelivered.bind(null, id)}
            />
          ) : loose ? (
            <Card>
              <CollectItemsForm fixPay={fixPay} action={collectItems.bind(null, id)} items={items.map((it) => ({ id: it.id, label: `${it.quantity > 1 ? `${it.quantity} × ` : ""}${it.item_type}${it.description ? ` · ${it.description}` : ""}`, collected: !!it.collected_at }))} canApproveRelease={role === "owner"} balance={{ state: bal.state, balance: bal.balance, invoiceNumber: bal.invoice?.number ?? null }} reasons={{ keys: reasonsFor(settings, "override_keys"), release: reasonsFor(settings, "release") }} />
            </Card>
          ) : (
            <Card>
              {bankHold.length && gateInRole ? <div className="mb-3 rounded-control border-2 border-amber-bar bg-amber-soft p-3 text-sm font-semibold" data-gateout-bank-hold>Waiting for the bank to clear a payment: call accounts.</div> : null}
              {bankHold.length && !gateInRole ? <div className="mb-3 rounded-control border-2 border-amber-bar bg-amber-soft p-3 text-sm font-semibold" data-gateout-bank-hold>Waiting for the bank: {bankHold.map((w) => `${w.method === "cheque" ? "cheque" : "transfer"} ${w.number} (AED ${w.amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })})`).join(", ")} has not cleared. The car stays until accounts mark it cleared{role === "owner" ? " – or release it now with a reason (logged)" : ", unless the owner approves"}.</div> : null}
              <GateOutForm
            fixPay={fixPay}
            fixSignoff={fixSignoff}
            mileage={mileage}
            drivers={drivers}
            lastPin={lastPin} customer={card.customer ? { name: card.customer.full_name, phone: card.customer.phone } : null} contacts={contacts} recoveryCompanies={(settings.recovery_companies ?? []) as string[]} finalCheck={finalCheck} creditDays={creditDays} declinedOut={declinedOut} jobId={id} signoffLock={signoff && signoff.hasStages && !signoff.complete ? `Release sign-off still needed from ${signoff.waitingOn.map((k) => SIGNOFF_LABELS[k]).join(", ")}. The handover stays locked until all have signed on the bodyshop page.` : null} action={gateOutJob.bind(null, id)} keysCount={g!.keys_count} keychain={g!.keys_keychain} dashCam={g!.dash_cam} oldParts={g!.old_parts_return} canOverride={can(role, "overrideKeys")} canApproveRelease={role === "owner"} ownerRelease={role === "owner" && !staff.viewingAs} noAmounts={gateInRole} balance={{ state: bal.state, balance: bal.balance, invoiceNumber: bal.invoice?.number ?? null }} reasons={{ keys: reasonsFor(settings, "override_keys"), release: reasonsFor(settings, "release") }} />
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-6">
          {!loose && g ? (
            <Card className="flex flex-col gap-2" data-gate-out-damage>
              {/* Section 4 (30 October 2026): what the car came in with, to check against at handover. */}
              <DamageSection damage={await loadCarDamage(id, { media: card.media, urls: card.mediaUrls })} arabic={false} heading="Damage at check-in" outlineSize={130} />
            </Card>
          ) : null}
          <Card className="flex flex-col gap-2">
            <SectionLabel>{gateInRole ? "Payment" : "Balance"}</SectionLabel>
            {gateInRole ? <p className={`text-sm font-semibold ${blocked ? "text-red" : "text-green-text"}`} data-gateout-payment-words>{blocked ? "Payment not complete: call accounts." : "Paid, or credit approved."}</p> : bal.state === "nothing" ? <p className="text-sm text-muted">Nothing to invoice on this job.</p> : bal.state === "no_invoice" ? <p className="text-sm font-semibold text-red">No invoice issued yet.</p> : (
              <DescriptionList items={[{ label: "Invoice", value: bal.invoice?.number ?? null }, { label: "Paid", value: `AED ${m(bal.paid)}` }, { label: "Balance due", value: <span className={bal.balance > 0 ? "font-bold text-red" : "font-bold text-green-text"}>AED {m(bal.balance)}</span> }, { label: "Cheques pending", value: bal.pending ? `AED ${m(bal.pending)}` : null }]} />
            )}
            {!gateInRole && bal.invoice ? <LinkButton href={`/invoices/${bal.invoice.id}`} tone="secondary" size="md">Open the invoice</LinkButton> : can(role, "issueInvoices") && bal.state === "no_invoice" ? <LinkButton href={`/jobs/${id}/invoice`} size="md">Issue the invoice</LinkButton> : null}
            {blocked && role !== "owner" && job.status !== "in_delivery" ? (
              <form action={askReleaseApproval.bind(null, id)}>
                <Button type="submit" tone="secondary" size="md">Ask the owner to approve the release</Button>
              </form>
            ) : null}
          </Card>
          {!loose && g ? (
          <Card className="flex flex-col gap-3">
            <SectionLabel>Keys at gate-in</SectionLabel>
            {keysPhotos.length ? (
              <div className="grid grid-cols-2 gap-2">
                {keysPhotos.map((p) => {
                  const url = card.mediaUrls.get(p.storage_path);
                  return url ? (
                    <a key={p.id} href={url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="Keys at gate-in" className="w-full rounded-card object-cover aspect-[4/3] bg-chip" />
                    </a>
                  ) : null;
                })}
              </div>
            ) : (
              <p className="text-sm text-muted">No keys photos on record.</p>
            )}
            <DescriptionList items={[{ label: "Keys received", value: `${g.keys_count}` }, { label: "Keychain", value: g.keys_keychain ? "Yes" : "No" }, { label: "Dash cam", value: g.dash_cam ? "Fitted, was disconnected" : "Not fitted" }, { label: "Old parts", value: g.old_parts_return ? "Customer wants them back" : "Not requested" }]} />
          </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
