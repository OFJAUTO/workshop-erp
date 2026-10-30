import Link from "next/link";
import { can } from "@/lib/roles";
import { TripOfficeBackup } from "@/components/TripOfficeBackup";
import { officeTripStepAction } from "@/app/(app)/jobs/delivery-actions";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Button, Card, Empty, Input, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { driverMessageFor, loadDrivers, tripCar, TRIP_SELECT, type TripRow } from "@/lib/delivery";
import { formatDate } from "@/lib/format";
import { haversineKm, onTheWayMessage, parseCoords, priceChangeMessage, priceFlagOf, priceHistoryOf, rateKindOf, recoveryRatesOf, RATE_KIND_LABELS, scheduleWords, usualRange } from "@/lib/recovery";
import { CopyText } from "@/components/CopyText";
import { getSettings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { shortFor } from "@/lib/short-links";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { TripActions } from "@/components/TripActions";
import { changeTripPrice, createPickupTrip, decideTrip, markMonthPaid, markTripSentById, recalcDistance, setTripKm, setTripPrice } from "@/app/(app)/jobs/delivery-actions";
import { NewTripForm } from "./NewTripForm";
import { ReasonChips } from "@/components/ReasonChips";
import { RecoveryProvidersCard } from "@/components/RecoveryProvidersCard";
import { recoveryProviderList } from "@/lib/recovery-providers";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = { open: "Booked", claimed: "Claimed", approved: "Approved", queried: "Queried", paid: "Paid" };
const STATUS_TONES: Record<string, "neutral" | "amber" | "green" | "ink" | "red"> = { open: "neutral", claimed: "amber", approved: "ink", queried: "red", paid: "green" };

/**
 * The recovery log (owner, advisors and accounts): one row per pick-up or delivery with the pin, the driver's photo
 * and his claimed price; Claimed -> Approved / Queried -> Paid with one tap; the rough straight-line distance from the
 * workshop so unusual prices stand out; a monthly view per driver or company with an export for accounts.
 * This replaces the WhatsApp group where the driver posted photos and prices.
 */
export default async function RecoveryPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; month?: string; who?: string; sent?: string; changed?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id;
  if (!["owner", "service_advisor", "accounts"].includes(role)) {
    return <Notice tone="error">The recovery log is for the owner, the advisors and accounts.</Notice>;
  }
  const canDecide = (role === "owner" || role === "accounts") && !staff.viewingAs;
  // Advisors see the trips list only: date, kind, car, who, the pin and the photo. Never a price, a km cost or a total.
  const seesMoney = role === "owner" || role === "accounts";
  // 30 October 2026: the office marks a step for a driver who could not press his button.
  const canMark = can(role, "gateOut") && !staff.viewingAs;
  const { message, error, month: monthParam, who: whoParam } = await searchParams;
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : new Date().toISOString().slice(0, 7);
  const admin = createAdminClient();
  const settings = await getSettings();
  const home = parseCoords(String(settings.workshop_location_pin ?? ""));
  const rates = recoveryRatesOf(settings);
  const flagPercent = Number(settings.recovery_flag_percent ?? 25);
  /** A UAE mobile as WhatsApp wants it: digits only, a leading 05 becomes 9715. */
  const waDigits = (phone: string | null | undefined) => { const d = String(phone ?? "").replace(/\D/g, ""); return /^05/.test(d) ? `971${d.slice(1)}` : d.replace(/^00/, ""); };
  const [{ data: rows }, drivers, { data: companyRows }, { data: payoutRows }] = await Promise.all([
    admin.from("recovery_trips").select(TRIP_SELECT).eq("is_active", true).order("created_at", { ascending: false }).limit(400),
    loadDrivers(),
    admin.from("recovery_companies").select("id, name, phone").eq("is_active", true).order("name"),
    admin.from("recovery_payouts").select("who, month, total_aed, paid_at").eq("month", monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : new Date().toISOString().slice(0, 7)),
  ]);
  const companies = (companyRows ?? []) as { id: string; name: string; phone: string | null }[];
  const ourDrivers = drivers.filter((d) => !d.company);
  const ourDriver = ourDrivers.find((d) => d.is_default) ?? ourDrivers[0] ?? null;
  const payoutOf = new Map(((payoutRows ?? []) as { who: string; total_aed: number | string; paid_at: string }[]).map((p) => [p.who, p]));
  const trips = (rows ?? []) as TripRow[];
  const jobIds = Array.from(new Set(trips.map((t) => t.job_id).filter((x): x is string => !!x)));
  const { data: jobs } = jobIds.length ? await admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number)").in("id", jobIds) : { data: [] };
  const jobOf = new Map((jobs ?? []).map((j) => [j.id, { number: j.job_number as string, plate: j.vehicle ? formatPlate(j.vehicle as unknown as Parameters<typeof formatPlate>[0]) : "" }]));
  const photoPaths = trips.map((t) => t.photo_path).filter((x): x is string => !!x);
  const { data: signed } = photoPaths.length ? await admin.storage.from("job-files").createSignedUrls(photoPaths, 3600) : { data: [] };
  const photoUrl = new Map((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));
  const whoOf = (t: TripRow) => t.company ?? (t.driver_name ? `Our truck · ${t.driver_name}` : "Our truck");
  const kmOf = (t: TripRow) => (t.road_km !== null ? Number(t.road_km) : home && t.lat !== null && t.lng !== null ? haversineKm(home, { lat: t.lat, lng: t.lng }) : null);
  // Open trips get the ONE trip component: the driver message, the short link and the customer's "on its way" text.
  const openTrips = trips.filter((t) => !t.delivered_at && t.token).slice(0, 20);
  const tripExtras = new Map<string, { driverText: string; shortLink: string; customerText: string | null; customerPhone: string | null }>();
  for (const t of openTrips) {
    const [driverText, shortLink, car] = await Promise.all([driverMessageFor(t), shortFor(`${PRODUCTION_SITE_URL}/drive/${t.token}`, "drive"), tripCar(t)]);
    const customerText = car.customerPhone ? onTheWayMessage(String(settings.whatsapp_on_the_way_template ?? ""), { name: car.customerName ?? "", car: car.car, truckPlate: t.truck_plate ?? "", driverName: t.driver_name ?? "", driverMobile: t.driver_phone ?? "" }) : null;
    tripExtras.set(t.id, { driverText, shortLink, customerText, customerPhone: car.customerPhone });
  }
  const history = trips.filter((t) => ["approved", "paid"].includes(t.status)).map((t) => ({ km: kmOf(t), price: t.price_aed === null ? null : Number(t.price_aed) }));
  const inMonth = trips.filter((t) => (t.delivered_at ?? t.created_at).startsWith(month));
  const whoList = Array.from(new Set(trips.map(whoOf))).sort();
  const shown = whoParam ? trips.filter((t) => whoOf(t) === whoParam) : trips;
  const monthTotals = new Map<string, { trips: number; total: number }>();
  for (const t of inMonth) {
    const k = whoOf(t);
    const cur = monthTotals.get(k) ?? { trips: 0, total: 0 };
    monthTotals.set(k, { trips: cur.trips + 1, total: cur.total + (Number(t.price_aed) || 0) });
  }
  const aedText = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <>
      <PageHeader title="Recovery" subtitle="Every pick-up and delivery: the pin, the driver's photo and his price. Claimed, then Approved or Queried, then Paid." />
      <LiveRefresh tables={["recovery_trips"]} alwaysPollMs={role === "owner" || role === "accounts" ? undefined : 120000} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {role === "owner" && !staff.viewingAs ? <RecoveryProvidersCard providers={await recoveryProviderList(settings)} /> : null}
      {!home ? <p className="text-xs text-muted">Distances show once the workshop&apos;s own pin is in Settings (&quot;Workshop location pin&quot;).</p> : null}

      {seesMoney ? (
      <Card className="flex flex-col gap-3" data-recovery-month>
        <SectionLabel right={<span className="flex gap-3"><a href={`/api/export/recovery?month=${month}`} className="underline underline-offset-4" data-export-excel>Export to Excel</a><a href={`/api/export/recovery?month=${month}&who=all`} className="underline underline-offset-4" data-export-all>All drivers</a></span>}>By driver or company · {month}</SectionLabel>
        <form className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Month<Input type="month" name="month" defaultValue={month} className="w-40" /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Driver or company<Select name="who" defaultValue={whoParam ?? ""} className="min-w-48"><option value="">Everyone</option>{whoList.map((w) => <option key={w} value={w}>{w}</option>)}</Select></label>
          <Button type="submit" tone="secondary" size="md">Show</Button>
        </form>
        {monthTotals.size === 0 ? <p className="text-sm text-muted">No trips this month.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-muted"><th className="py-1 pr-3">Driver or company</th><th className="py-1 pr-3 text-right">Trips</th><th className="py-1 pr-3 text-right">Total</th><th className="py-1 pr-3 text-right">Average</th><th className="py-1 text-right">Month&apos;s payment</th></tr></thead>
            <tbody className="divide-y divide-line">
              {Array.from(monthTotals.entries()).sort((a, b) => b[1].total - a[1].total).map(([w, s]) => {
                const paid = payoutOf.get(w);
                const whoTrips = inMonth.filter((t) => whoOf(t) === w);
                const openCount = whoTrips.filter((t) => t.status !== "approved" && t.status !== "paid").length;
                const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
                return (
                  <tr key={w} data-recovery-who={w}>
                    <td className="py-1.5 pr-3 font-semibold">{w}</td><td className="py-1.5 pr-3 text-right">{s.trips}</td><td className="py-1.5 pr-3 text-right font-bold">{aedText(s.total)}</td><td className="py-1.5 pr-3 text-right">{aedText(s.trips ? s.total / s.trips : 0)}</td>
                    <td className="py-1.5 text-right">
                      {paid ? <span className="inline-flex items-center rounded-control bg-green-soft px-2 py-1 text-xs font-bold text-green" data-month-paid-done>Paid ✓ {formatDate(paid.paid_at)}</span>
                        : openCount ? <span className="text-xs font-semibold text-amber" data-month-open>{openCount} trip{openCount === 1 ? "" : "s"} not approved yet</span>
                        : canDecide ? (
                          <form action={markMonthPaid} className="inline">
                            <input type="hidden" name="who" value={w} />
                            <input type="hidden" name="month" value={month} />
                            <Button type="submit" tone="secondary" size="md" data-month-pay>Mark {monthName} paid · {aedText(s.total)}</Button>
                          </form>
                        ) : <span className="text-xs text-muted">Ready to pay</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${shown.length}`}>Trips</SectionLabel>
        {shown.length === 0 ? <Empty title="No trips yet" /> : (
          <ul className="flex flex-col divide-y divide-line">
            {shown.slice(0, 120).map((t) => {
              const j = t.job_id ? jobOf.get(t.job_id) : null;
              const km = kmOf(t);
              const price = t.price_aed === null ? null : Number(t.price_aed);
              const usual = seesMoney && km !== null && t.status === "claimed" ? usualRange(km, history) : null;
              return (
                <li key={t.id} id={`trip-${t.id}`} className="py-3 flex flex-col gap-1.5 scroll-mt-24" data-trip={t.id} data-trip-status={t.status}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-bold">{formatDate(t.delivered_at ?? t.created_at)}</span>
                    <Badge tone="ink">{t.kind === "pickup" ? "Pick-up" : "Delivery"}</Badge>
                    {j ? <Link href={`/jobs/${t.job_id}`} className="font-semibold underline underline-offset-4">{j.plate} · {j.number}</Link> : <span className="text-muted">{t.location_details ?? "No job"}</span>}
                    <span className="text-muted">{whoOf(t)}</span>
                    {t.location_url ? <a href={t.location_url} target="_blank" rel="noreferrer" className="underline underline-offset-4" data-trip-pin>Open the pin</a> : null}
                    {seesMoney && t.road_km !== null ? <span className="text-xs text-muted" data-trip-km>{Number(t.road_km)} km{price && Number(t.road_km) > 0 ? ` · AED ${(price / Number(t.road_km)).toFixed(0)}/km` : ""}</span> : null}
                    {t.photo_path && photoUrl.get(t.photo_path) ? <a href={photoUrl.get(t.photo_path) ?? "#"} target="_blank" rel="noreferrer" className="underline underline-offset-4" data-trip-photo>Photo</a> : null}
                    <span className="ml-auto inline-flex items-center gap-2">
                      {seesMoney ? (price !== null ? <span className="font-bold" data-trip-price>{aedText(price)}</span> : <span className="text-xs text-muted">no price yet</span>) : t.company && price === null ? <span className="text-xs text-muted" data-price-with-accounts>Price: with accounts</span> : null}
                      {seesMoney ? <Badge tone={STATUS_TONES[t.status]}>{STATUS_LABELS[t.status]}</Badge> : <Badge tone={t.delivered_at ? "green" : "amber"} data-plain-status>{t.delivered_at ? `Delivered ✓ ${new Date(t.delivered_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" })}` : t.loaded_at || t.sent_at ? "On the way" : "Booked"}</Badge>}
                    </span>
                  </div>
                  {!t.delivered_at ? <p className="text-xs text-muted">{scheduleWords(t.scheduled_date, t.scheduled_slot)}</p> : null}
                  {tripExtras.has(t.id) ? (
                    <TripActions
                      kind={t.kind}
                      driverName={t.driver_name}
                      driverPhone={t.driver_phone}
                      customerPhone={tripExtras.get(t.id)!.customerPhone}
                      driverText={tripExtras.get(t.id)!.driverText}
                      customerText={tripExtras.get(t.id)!.customerText}
                      shortLink={tripExtras.get(t.id)!.shortLink}
                      sentAt={t.sent_at}
                      loadedAt={t.loaded_at}
                      deliveredAt={t.delivered_at}
                      onMarkSent={markTripSentById.bind(null, t.id)}
                    />
                  ) : null}
                  {!t.delivered_at && canMark ? <TripOfficeBackup tripId={t.id} kind={t.kind} loadedAt={t.loaded_at} action={officeTripStepAction.bind(null, t.id)} /> : null}
                  {t.marked_by && price === null && canDecide ? (
                    <form action={setTripPrice.bind(null, t.id)} className="flex flex-wrap items-center gap-2">
                      <Input name="price" inputMode="decimal" placeholder="Driver's price (AED)" className="w-40 min-h-9" data-trip-price-box />
                      <Button type="submit" tone="secondary" size="md">Save price</Button>
                    </form>
                  ) : null}
                  {usual ? <p className="text-xs font-semibold text-muted" data-trip-usual>Usual for this distance: AED {usual.low.toLocaleString("en-GB")}–{usual.high.toLocaleString("en-GB")} ({usual.n} trips)</p> : null}
                  {seesMoney && t.status === "queried" && t.query_note ? <p className="text-xs font-semibold text-red">Query: {t.query_note}</p> : null}
                  {(() => {
                    // Section 3 (23 October 2026): the price changes, the original crossed out; the flag against the normal rate.
                    if (!seesMoney) return null;
                    const changes = priceHistoryOf(t.price_history);
                    const kind = rateKindOf(t);
                    const flag = ["claimed", "queried"].includes(t.status) ? priceFlagOf(price, km, rates[kind], flagPercent) : null;
                    const last = changes.at(-1) ?? null;
                    const phone = t.company ? companies.find((c) => c.name.toLowerCase() === (t.company ?? "").toLowerCase())?.phone ?? t.driver_phone : t.driver_phone;
                    const msg = last ? priceChangeMessage({ kind: t.kind, date: t.delivered_at ?? t.created_at, place: t.location_details ?? (j ? j.plate : null) }, last.from, last.to, last.reason) : null;
                    return (
                      <>
                        {changes.length ? (
                          <ul className="flex flex-col gap-0.5 text-xs" data-price-history>
                            {changes.map((c, i) => (
                              <li key={i} className="flex flex-wrap items-center gap-1.5"><span className="text-muted line-through" data-price-original>AED {c.from.toLocaleString("en-GB")}</span><span>→</span><span className="font-bold">AED {c.to.toLocaleString("en-GB")}</span><span className="text-muted">· {c.reason} · {c.by_name ?? ""} {c.at ? formatDate(c.at) : ""}</span></li>
                            ))}
                          </ul>
                        ) : null}
                        {flag?.high ? <p className="text-xs font-semibold text-red" data-trip-flag>{flag.words} ({RATE_KIND_LABELS[kind].toLowerCase()} rate)</p> : null}
                        {msg && t.status !== "paid" && canDecide ? (
                          <div className="flex flex-wrap items-center gap-2 rounded-control border border-line bg-canvas px-2 py-1.5 text-xs" data-price-change-message>
                            <span className="font-semibold">Tell the driver:</span>
                            <span className="min-w-0 flex-1">{msg}</span>
                            <a href={`https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-control bg-ink px-3 font-bold text-white" data-price-change-whatsapp>WhatsApp</a>
                            <CopyText text={msg} small />
                          </div>
                        ) : null}
                        {canDecide && price !== null && ["claimed", "queried"].includes(t.status) ? (
                          <details className="text-sm" data-change-price>
                            <summary className="cursor-pointer min-h-9 inline-flex items-center rounded-control border border-line-strong bg-white px-3 text-xs font-bold">Change price…</summary>
                            <form action={changeTripPrice.bind(null, t.id)} className="mt-2 flex flex-wrap items-end gap-2">
                              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">New price (AED)
                                <Input name="price" inputMode="decimal" defaultValue={flag?.high ? String(flag.expected) : ""} placeholder={flag ? `Expected ~${flag.expected}` : "AED"} className="w-32 min-h-9" data-change-price-box />
                              </label>
                              {flag?.high ? <span className="self-center text-xs text-muted" data-change-price-suggested>Suggested: AED {flag.expected.toLocaleString("en-GB")}</span> : null}
                              <ReasonChips name="reason" label="Why?" rows={1} options={["Price looks high for the distance", "Agreed with the driver", "Normal rate for this trip", "Two trips claimed as one"]} required placeholder="Tap or type" />
                              <Button type="submit" tone="secondary" size="md" data-change-price-save>Change price</Button>
                            </form>
                          </details>
                        ) : null}
                      </>
                    );
                  })()}
                  {canDecide && price !== null && ["claimed", "queried", "approved"].includes(t.status) ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {t.status !== "approved" ? <form action={decideTrip.bind(null, t.id)}><input type="hidden" name="decision" value="approve" /><Button type="submit" size="md" data-trip-approve>Approve</Button></form> : null}
                      {t.status === "claimed" ? (
                        <details className="text-sm"><summary className="cursor-pointer min-h-9 inline-flex items-center rounded-control border border-line-strong bg-white px-3 text-xs font-bold">Query…</summary>
                          <form action={decideTrip.bind(null, t.id)} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="decision" value="query" /><ReasonChips name="note" label="What looks wrong?" rows={1} options={["Price looks high for the distance", "Wrong trip", "Two trips claimed as one"]} required placeholder="Tap or type" /><Button type="submit" tone="secondary" size="md" data-trip-query>Send query</Button></form>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                  {t.road_km === null && canDecide ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={setTripKm.bind(null, t.id)} className="flex flex-wrap items-center gap-2" data-enter-km>
                        <span className="text-xs font-semibold text-amber" data-km-why>Distance not found{t.km_error ? ` – ${t.km_error}` : ""} – enter km</span>
                        <Input name="km" inputMode="decimal" placeholder="One-way km" className="w-32 min-h-9" data-km-box />
                        <Button type="submit" tone="secondary" size="md">Save</Button>
                      </form>
                      <form action={recalcDistance.bind(null, t.id)}><Button type="submit" tone="ghost" size="md" data-recalc-km>Recalculate distance</Button></form>
                    </div>
                  ) : t.road_km !== null && canDecide ? (
                    <form action={recalcDistance.bind(null, t.id)} className="self-start"><Button type="submit" tone="ghost" size="md" data-recalc-km>Recalculate distance</Button></form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3" data-new-pickup>
        <SectionLabel>New pick-up or delivery</SectionLabel>
        <NewTripForm ourDriver={ourDriver ? { id: ourDriver.id, name: ourDriver.name } : null} companies={companies} action={createPickupTrip} />
        <p className="text-xs text-muted">The driver gets the same one-button link: photo on loading, then his price. This page replaces the WhatsApp group.</p>
      </Card>
    </>
  );
}
