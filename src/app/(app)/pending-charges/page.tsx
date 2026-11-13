import Link from "next/link";
import { refuse } from "@/lib/refusal";
import { MessageSendButton } from "@/components/MessageSendButton";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { ChargeLinesEditor } from "@/components/ChargeLinesEditor";
import { CopyText } from "@/components/CopyText";
import { RecordPaymentButton } from "@/components/RecordPaymentHost";
import { Badge, Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { chargeNet, pendingDays } from "@/lib/charge-rules";
import { chargesReady, loadChargeEntries, type EntryView } from "@/lib/charges";
import { formatDate } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { shortFor } from "@/lib/short-links";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { cancelEntryAction, createEntryAction, issueEntryTaxInvoiceAction } from "./actions";
import { roundInvoice } from "@/app/(app)/invoices/actions";
import { RoundOff } from "@/components/RoundOff";
import { roundoffLimitsOf } from "@/lib/roundoff";

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Search = { open?: string; new?: string; customer?: string; cq?: string; status?: string; q?: string; provider?: string; from?: string; to?: string; message?: string; error?: string };

/**
 * PENDING CHARGES (1 November 2026): bills for cars that are NOT in the workshop - a recovery-only trip, a car that
 * never came in, or one that came and left with a charge still open. No gate-in, no job card, never on the dashboard.
 * Each has its own PROFORMA until it is paid; paid in full, the tax invoice is issued by itself.
 */
export default async function PendingChargesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireStaff();
  if (!["owner", "service_advisor", "accounts"].includes(staff.role_id)) return refuse("no_permission");
  const sp = await searchParams;
  const settings = await getSettings();
  const ready = await chargesReady();
  const status = sp.status ?? "pending";
  const all = ready ? await loadChargeEntries() : [];
  const needle = (sp.q ?? "").trim().toLowerCase();
  const rows = all.filter((e) => (status === "all" ? e.status !== "cancelled" : e.status === status) && (!needle || [e.customer, e.phone ?? "", e.plate ?? "", e.car ?? "", e.what, e.proformaNumber ?? "", e.taxNumber ?? ""].join(" ").toLowerCase().includes(needle)) && (!sp.provider || (e.provider ?? "").toLowerCase() === sp.provider.toLowerCase()) && (!sp.from || e.service_date >= sp.from) && (!sp.to || e.service_date <= sp.to));
  const pending = all.filter((e) => e.status === "pending");
  const open = sp.open ? all.find((e) => e.id === sp.open) ?? null : null;
  const providers = Array.from(new Set(all.map((e) => e.provider).filter((x): x is string => !!x))).sort();
  const remindDays = Number((settings as unknown as Record<string, unknown>).pending_charges_reminder_days) || 7;
  const params = new URLSearchParams(Object.entries({ status: sp.status ?? "", q: sp.q ?? "", provider: sp.provider ?? "", from: sp.from ?? "", to: sp.to ?? "" }).filter(([, v]) => v));

  return (
    <>
      <PageHeader title="Pending charges" subtitle="Charges for cars not in the workshop: recovery-only trips, cars that never came in, or bills still open after a car left. Each has its own proforma until it is paid." actions={<><LinkButton href="/pending-charges?new=1" size="lg" data-pc-new>+ New pending charge</LinkButton><LinkButton href={`/api/export/pending-charges?${params.toString()}`} tone="secondary" size="lg" data-pc-export>Export to Excel</LinkButton></>} />
      {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
      {!ready ? <Notice tone="info">Pending charges switch on with the database update (waiting for apply).</Notice> : null}

      {ready && sp.new ? <NewEntry sp={sp} /> : null}
      {open ? <OpenEntry e={open} staffRole={staff.role_id} viewingAs={!!staff.viewingAs} remindDays={remindDays} /> : null}

      <Card className="flex flex-col gap-3" data-pc-filters>
        <div className="flex flex-wrap items-center gap-2 text-sm" data-pc-totals>
          <span className="font-extrabold">Pending: {pending.length} · AED {money(pending.reduce((a, e) => a + e.balance, 0))}</span>
        </div>
        <form method="get" action="/pending-charges" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Show
            <Select name="status" defaultValue={status} className="w-36" data-pc-status-filter>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="all">All</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Customer, plate or number<Input name="q" defaultValue={sp.q ?? ""} className="w-60" data-pc-search /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Provider
            <Select name="provider" defaultValue={sp.provider ?? ""} className="w-52">
              <option value="">Any provider</option>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">From<Input type="date" name="from" defaultValue={sp.from ?? ""} className="w-40" /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">To<Input type="date" name="to" defaultValue={sp.to ?? ""} className="w-40" /></label>
          <Button type="submit" size="md" tone="secondary">Show</Button>
        </form>
      </Card>

      <section className="flex flex-col gap-2" data-pc-list>
        {rows.length === 0 ? <Card><p className="text-sm text-muted">Nothing here.</p></Card> : null}
        {rows.map((e) => {
          const days = pendingDays(e.created_at);
          return (
            <Card key={e.id} className={`relative !p-0 hover:border-ink ${open?.id === e.id ? "!border-ink" : ""}`} data-pc-row={e.id} data-pc-state={e.status}>
              <Link href={`/pending-charges?${new URLSearchParams([...params.entries(), ["open", e.id]]).toString()}`} aria-label={`Open the pending charge of ${e.customer}`} className="absolute inset-0 z-0 rounded-card" data-overlap-ok />
              <div className="pointer-events-none relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 p-4">
                <span className="font-extrabold uppercase">{e.customer}</span>
                <span className="text-sm font-semibold">{e.plate ?? "No car on record"}{e.car ? ` · ${e.car}` : ""}</span>
                <Badge tone={e.status === "paid" ? "green" : e.status === "cancelled" ? "neutral" : days >= remindDays ? "red" : "amber"}>{e.status === "paid" ? "Paid" : e.status === "cancelled" ? "Cancelled" : `Pending ${days} day${days === 1 ? "" : "s"}`}</Badge>
                <span className="ml-auto text-sm font-extrabold">AED {money(e.total)}</span>
                <span className="basis-full text-xs text-muted">{e.what} · {formatDate(e.service_date)}{e.provider ? ` · ${e.provider}` : ""}{e.proformaNumber ? ` · ${e.proformaNumber}` : ""}{e.taxNumber ? ` → ${e.taxNumber}` : ""}{e.paid > 0 && e.status !== "paid" ? ` · AED ${money(e.paid)} of ${money(e.total)} paid` : ""}{e.jobNumber ? ` · came in as ${e.jobNumber}` : ""}</span>
              </div>
            </Card>
          );
        })}
      </section>
    </>
  );
}

async function OpenEntry({ e, staffRole, viewingAs, remindDays }: { e: EntryView; staffRole: string; viewingAs: boolean; remindDays: number }) {
  const accounts = ["owner", "accounts"].includes(staffRole) && !viewingAs;
  const link = e.proformaToken ? await shortFor(`${PRODUCTION_SITE_URL}/proforma/${e.proformaToken}`).catch(() => null) : null;
  const msg = link ? `Dear ${e.customer}, please find the proforma for ${e.what.toLowerCase()} (AED ${money(e.balance)} with VAT): ${link} Thank you, OFJ Automotive` : null;
  // The optional round-off on the pending charge's proforma (3 November 2026): same control as every document.
  const proformaId = (e as unknown as { proforma_id?: string | null }).proforma_id ?? null;
  const { data: proRow } = proformaId && e.status === "pending" && accounts ? await createAdminClient().from("invoices").select("id, kind, status, converted_to, subtotal_aed, discount_aed, warranty_credit_aed, taxable_aed, total_aed").eq("id", proformaId).maybeSingle() : { data: null };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pro = proRow && proRow.kind === "proforma" && proRow.status === "issued" && !proRow.converted_to
    ? (() => {
        const net = r2((Number(proRow.subtotal_aed) || 0) - (Number(proRow.discount_aed) || 0) - (Number(proRow.warranty_credit_aed) || 0));
        const vat = r2(net * 0.05);
        return { net, baseTotal: r2(net + vat), rounding: r2((Number(proRow.taxable_aed) || 0) - net), total: Number(proRow.total_aed) || 0 };
      })()
    : null;
  const limits = roundoffLimitsOf(await getSettings());
  return (
    <Card className="flex flex-col gap-3 !border-ink" data-pc-opened={e.id}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel>{e.customer} · {e.plate ?? "No car on record"}</SectionLabel>
        <Badge tone={e.status === "paid" ? "green" : e.status === "cancelled" ? "neutral" : "amber"}>{e.status === "paid" ? `Paid · ${e.taxNumber}` : e.status === "cancelled" ? "Cancelled" : `Pending · ${e.proformaNumber ?? "no proforma"}`}</Badge>
      </div>
      <ul className="divide-y divide-line text-sm">
        {e.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 py-1.5" data-pc-line>
            <span className="min-w-0 flex-1 font-semibold uppercase">{l.description}</span>
            {l.provider ? <span className="text-muted">{l.provider}</span> : null}
            <span className="text-muted">cost AED {money(l.cost_aed)}</span>
            <span className="font-bold">{l.free ? "Free" : `AED ${money(chargeNet(l))} + VAT`}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm" data-pc-money>Total AED <b>{money(e.total)}</b> with VAT · paid AED {money(e.paid)} · balance <b>AED {money(e.balance)}</b>{e.status === "pending" && pendingDays(e.created_at) >= remindDays ? <span className="font-bold text-red"> · pending {pendingDays(e.created_at)} days</span> : null}</p>
      {e.status === "pending" ? (
        <div className="flex flex-wrap items-start gap-3">
          {link && msg ? <MessageSendButton label="Send the proforma (WhatsApp)" title="Send the proforma" message={msg} phoneDigits={(e.phone ?? "").replace(/[^\d]/g, "")} what={`Pending charge proforma${e.proformaNumber ? ` ${e.proformaNumber}` : ""}`} target={{ table: "charge_entries", recordId: e.id }} hook="pc-send" /> : null}
          {msg ? <CopyText text={msg} label="Copy message" /> : null}
          {accounts ? <RecordPaymentButton customerId={e.customer_id} vehicleId={e.vehicle_id ?? undefined} label="Record payment" /> : null}
          {accounts && pro && proformaId ? <RoundOff docWords="proforma" baseTotal={pro.baseTotal} baseNet={pro.net} rounding={pro.rounding} appliedTotal={pro.total} vatPercent={5} isOwner={staffRole === "owner"} limits={limits} approvedCap={null} refuseOverLimit apply={roundInvoice.bind(null, proformaId)} /> : null}
          {e.proformaToken ? <a href={`/proforma/${e.proformaToken}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4" data-pc-proforma>Open the proforma</a> : null}
        </div>
      ) : null}
      {e.status === "pending" && accounts ? (
        <form action={issueEntryTaxInvoiceAction.bind(null, e.id)} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Input name="reason" required minLength={5} placeholder="Why before full payment?" className="w-72" textCase="sentence" aria-label="Why issue the tax invoice now" />
          <ConfirmSubmit
            label="Issue tax invoice"
            size="md"
            tone="secondary"
            title="Issue the tax invoice now?"
            lines={[`A tax invoice for these charges (AED ${money(e.total)} with VAT, AED ${money(e.balance)} still to pay) is numbered now, before full payment`, "it goes to Zoho Books"]}
            live={[{ label: "Reason:", field: "reason" }]}
            confirmLabel="Yes, issue the tax invoice"
            hook="pc-issue"
            attrs={{ "data-pc-issue": "" }}
          />
        </form>
      ) : null}
      {e.status === "pending" && !viewingAs ? (
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-bold text-red underline underline-offset-4 [&::-webkit-details-marker]:hidden">Cancel this pending charge</summary>
          <form action={cancelEntryAction.bind(null, e.id)} className="mt-2 flex flex-wrap items-center gap-2">
            <Input name="reason" required minLength={5} placeholder="Why?" className="w-72" textCase="sentence" aria-label="Why cancel" />
            <Button type="submit" size="md" tone="danger">Cancel it</Button>
          </form>
        </details>
      ) : null}
    </Card>
  );
}

/** The new pending charge: the customer (search or quick add), the car (picked, new, or none), the job (optional), the lines. */
async function NewEntry({ sp }: { sp: Search }) {
  const admin = createAdminClient();
  const settings = await getSettings();
  const cq = (sp.cq ?? "").trim();
  const { data: found } = cq.length >= 2 ? await admin.from("customers").select("id, full_name, company_name, phone").or(`full_name.ilike.%${cq.replace(/[%,()]/g, "")}%,company_name.ilike.%${cq.replace(/[%,()]/g, "")}%,phone.ilike.%${cq.replace(/[^\d]/g, "") || "~"}%`).limit(8) : { data: [] };
  const customer = sp.customer ? (await admin.from("customers").select("id, full_name, company_name, phone").eq("id", sp.customer).maybeSingle()).data : null;
  const [{ data: cars }, { data: jobs }, { data: makes }] = await Promise.all([
    customer ? admin.from("vehicles").select("id, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)").eq("customer_id", customer.id).eq("is_active", true) : Promise.resolve({ data: [] }),
    customer ? admin.from("jobs").select("id, job_number, is_open, gated_in_at").eq("customer_id", customer.id).order("gated_in_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    admin.from("vehicle_makes").select("id, name").order("name"),
  ]);
  type Car = Parameters<typeof formatPlate>[0] & { id: string; make: { name: string } | null; model: { name: string } | null };
  // eslint-disable-next-line react-hooks/purity
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  return (
    <Card className="flex flex-col gap-4 !border-ink" data-pc-new-form>
      <SectionLabel>New pending charge</SectionLabel>
      {!customer ? (
        <>
          <form method="get" action="/pending-charges" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="new" value="1" />
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Find the customer (name or mobile)<Input name="cq" defaultValue={cq} className="w-72" data-pc-customer-search /></label>
            <Button type="submit" size="md" tone="secondary">Find</Button>
          </form>
          {(found ?? []).length ? (
            <ul className="flex flex-col gap-1" data-pc-customer-results>
              {(found ?? []).map((c) => <li key={c.id as string}><Link href={`/pending-charges?new=1&customer=${c.id}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-3 text-sm font-semibold hover:border-ink" data-pc-customer-pick={c.id as string}>{(c.company_name as string | null) ?? (c.full_name as string)} · {c.phone as string}</Link></li>)}
            </ul>
          ) : null}
          <form action={createEntryAction} className="flex flex-col gap-3 border-t border-line pt-3" data-pc-quick-customer>
            <span className="text-sm font-bold">Or a new customer, with a charge right away</span>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Name<Input name="new_name" className="w-60" textCase="upper" data-pc-new-name /></label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Mobile<Input name="new_phone" inputMode="tel" className="w-44" data-pc-new-phone /></label>
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="new_company" className="h-5 w-5 accent-ink" />A company</label>
            </div>
            <input type="hidden" name="vehicle_id" value="none" />
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted w-44">Date of the service<Input type="date" name="service_date" defaultValue={today} /></label>
            <ChargeLinesEditor recoveryTypes={(settings.recovery_types ?? []) as { key: string; label: string; cost: number; price: number }[]} providers={(settings.recovery_companies ?? []) as string[]} />
            <div><Button type="submit" size="lg">Save and make the proforma</Button></div>
          </form>
        </>
      ) : (
        <form action={createEntryAction} className="flex flex-col gap-3" data-pc-entry-form>
          <input type="hidden" name="customer_id" value={customer.id as string} />
          <p className="text-sm"><b className="uppercase">{(customer.company_name as string | null) ?? (customer.full_name as string)}</b> · {customer.phone as string} · <Link href="/pending-charges?new=1" className="underline">another customer</Link></p>
          <fieldset className="flex flex-col gap-1.5" data-pc-car>
            <legend className="text-xs font-semibold text-muted">Car</legend>
            {((cars ?? []) as unknown as Car[]).map((c, i) => (
              <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="vehicle_id" value={c.id} defaultChecked={i === 0} className="h-5 w-5 accent-ink" data-pc-car-pick={c.id} />{formatPlate(c)} · {[c.make?.name, c.model?.name].filter(Boolean).join(" ")}</label>
            ))}
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="vehicle_id" value="new" className="h-5 w-5 accent-ink" />A car not on record:
              <Input name="new_plate" placeholder="Plate number" className="w-32" textCase="upper" />
              <Input name="new_code" placeholder="Code" className="w-20" textCase="upper" />
              <select name="new_make" className="h-11 rounded-control border border-line-strong bg-white px-2 text-sm"><option value="">Make…</option>{(makes ?? []).map((m) => <option key={m.id as string} value={m.id as string}>{m.name as string}</option>)}</select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="vehicle_id" value="none" defaultChecked={!(cars ?? []).length} className="h-5 w-5 accent-ink" data-pc-no-car />No car on record</label>
          </fieldset>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">The job, if the car came and went (optional)
            <select name="job_id" className="h-11 w-64 rounded-control border border-line-strong bg-white px-2 text-sm" data-pc-job>
              <option value="">None</option>
              {(jobs ?? []).map((j) => <option key={j.id as string} value={j.id as string}>{j.job_number as string}{j.is_open ? " (in the workshop)" : ""}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted w-44">Date of the service<Input type="date" name="service_date" defaultValue={today} data-pc-date /></label>
          <ChargeLinesEditor recoveryTypes={(settings.recovery_types ?? []) as { key: string; label: string; cost: number; price: number }[]} providers={(settings.recovery_companies ?? []) as string[]} />
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Note (internal)<Input name="note" className="w-full" textCase="sentence" /></label>
          <div><Button type="submit" size="lg" data-pc-save>Save and make the proforma</Button></div>
        </form>
      )}
    </Card>
  );
}
