import Link from "next/link";
import { CopyText } from "@/components/CopyText";
import { Badge, Button, Card, Input, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ReasonChips } from "@/components/ReasonChips";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { reasonsFor } from "@/lib/reasons";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { changeExpectedDate } from "./actions";

export const dynamic = "force-dynamic";

const SPECIAL_LEAD_DAYS = 15;

type Row = {
  key: string;
  partId: string | null;
  name: string;
  qty: number;
  supplier: string | null;
  supplierPhone: string | null;
  plate: string | null;
  jobId: string | null;
  jobNumber: string | null;
  lpo: string | null;
  expected: string;
  special: boolean;
  stock: boolean;
};

/**
 * Parts arrivals: the Parts role's week instead of the calendar. Per day: the parts expected, with the supplier, the
 * car and the LPO. Overdue ones sit on top in red with "Chase supplier"; special orders (15 days' lead or more, or a
 * back order) are marked; one tap moves a part's expected date with a reason, the car's promised date follows and the
 * advisor is told. Workshop stock orders show too, marked Stock.
 */
export default async function ArrivalsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; week?: string; supplier?: string; special?: string }> }) {
  await requirePermission("priceParts");
  const { message, error, week: weekParam, supplier: supplierParam, special: specialParam } = await searchParams;
  const week = weekParam === "next" ? "next" : "this";
  const admin = createAdminClient();
  const settings = await getSettings();
  // eslint-disable-next-line react-hooks/purity -- a server page: today is read once per request
  const now = Date.now() + 4 * 3600000;
  const today = new Date(now).toISOString().slice(0, 10);
  const day = (plus: number) => new Date(now + plus * 86400000).toISOString().slice(0, 10);
  const weekStartPlus = week === "next" ? 7 : 0;

  const [{ data: partRows }, { data: stockRows }] = await Promise.all([
    admin.from("part_items").select("id, job_id, description, quantity, confirmed_quantity, received_qty, expected_date, supplier, availability, priced_at, po_id, order_status").eq("is_active", true).not("expected_date", "is", null).in("order_status", ["ordered", "partly_received", "to_order"]),
    admin.from("purchase_order_lines").select("id, description, quantity, received_qty, expected_date, po:purchase_orders!inner(id, number, kind, status, supplier_name, order_type)").eq("is_active", true).eq("po.kind", "stock").in("po.status", ["ordered", "approved"]).not("expected_date", "is", null),
  ]);
  const parts = ((partRows ?? []) as { id: string; job_id: string; description: string; quantity: number | string; confirmed_quantity: number | string | null; received_qty: number | string; expected_date: string; supplier: string | null; availability: string | null; priced_at: string | null; po_id: string | null; order_status: string }[])
    .filter((p) => Number(p.received_qty) < Number(p.confirmed_quantity ?? p.quantity));
  const jobIds = Array.from(new Set(parts.map((p) => p.job_id)));
  const [{ data: jobRows }, { data: poRows }, { data: supplierRows }] = await Promise.all([
    jobIds.length ? admin.from("jobs").select("id, job_number, is_open, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number)").in("id", jobIds) : Promise.resolve({ data: [] }),
    admin.from("purchase_orders").select("id, number").eq("is_active", true),
    admin.from("suppliers").select("name, phone").eq("is_active", true),
  ]);
  const jobs = new Map(((jobRows ?? []) as unknown as { id: string; job_number: string; is_open: boolean; vehicle: Parameters<typeof formatPlate>[0] | null }[]).filter((j) => j.is_open).map((j) => [j.id, j]));
  const poNumber = new Map(((poRows ?? []) as { id: string; number: string }[]).map((p) => [p.id, p.number]));
  const phoneOf = new Map(((supplierRows ?? []) as { name: string; phone: string | null }[]).map((s) => [s.name.toLowerCase(), s.phone]));

  const rows: Row[] = [];
  for (const p of parts) {
    const j = jobs.get(p.job_id);
    if (!j) continue;
    const lead = p.priced_at ? Math.round((Date.parse(p.expected_date) - Date.parse(p.priced_at)) / 86400000) : 0;
    rows.push({
      key: `p:${p.id}`, partId: p.id, name: p.description, qty: Number(p.confirmed_quantity ?? p.quantity) || 1,
      supplier: p.supplier, supplierPhone: p.supplier ? (phoneOf.get(p.supplier.toLowerCase()) ?? null) : null,
      plate: j.vehicle ? formatPlate(j.vehicle) : null, jobId: p.job_id, jobNumber: j.job_number,
      lpo: p.po_id ? (poNumber.get(p.po_id) ?? null) : null, expected: p.expected_date,
      special: lead >= SPECIAL_LEAD_DAYS, stock: false,
    });
  }
  for (const l of (stockRows ?? []) as unknown as { id: string; description: string; quantity: number | string; received_qty: number | string; expected_date: string; po: { id: string; number: string; supplier_name: string | null } }[]) {
    if (Number(l.received_qty) >= Number(l.quantity)) continue;
    rows.push({ key: `s:${l.id}`, partId: null, name: l.description, qty: Number(l.quantity) || 1, supplier: l.po.supplier_name, supplierPhone: l.po.supplier_name ? (phoneOf.get(l.po.supplier_name.toLowerCase()) ?? null) : null, plate: null, jobId: null, jobNumber: null, lpo: l.po.number, expected: l.expected_date, special: false, stock: true });
  }

  const suppliers = Array.from(new Set(rows.map((r) => r.supplier).filter((x): x is string => !!x))).sort();
  const shown = rows.filter((r) => (!supplierParam || r.supplier === supplierParam) && (specialParam !== "1" || r.special));
  const overdue = shown.filter((r) => r.expected < today).sort((a, b) => a.expected.localeCompare(b.expected));
  const weekDays = Array.from({ length: 7 }, (_, i) => day(weekStartPlus + i));
  const reasons = reasonsFor(settings, "parts_delay");

  const chase = (r: Row) => {
    const text = `Hello, checking on our order ${r.lpo ?? ""}: ${r.qty} × ${r.name}${r.plate ? ` for ${r.plate}` : ""}. It was expected ${formatDate(r.expected)}. When will it arrive?`;
    return r.supplierPhone
      ? <span className="inline-flex flex-wrap gap-1.5"><a href={`https://wa.me/${r.supplierPhone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-control border border-red-bar bg-white px-3 text-xs font-bold text-red" data-chase>Chase supplier</a><CopyText text={text} small /></span>
      : <span className="text-xs text-muted" data-chase-nophone>No phone on the supplier (add it under Suppliers)</span>;
  };

  const line = (r: Row, red = false) => (
    <li key={r.key} className={`py-2 flex flex-col gap-1.5 ${red ? "rounded-control border border-red-bar bg-red-soft px-3" : ""}`} data-arrival={r.key} data-arrival-overdue={red ? "1" : undefined}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold uppercase">{r.qty > 1 ? `${r.qty} × ` : ""}{r.name}</span>
        {r.stock ? <Badge tone="ink">Stock</Badge> : null}
        {r.special ? <Badge tone="amber">Special order</Badge> : null}
        {r.supplier ? <span className="text-muted">{r.supplier}</span> : null}
        {r.jobId ? <Link href={`/parts/${r.jobId}`} className="font-semibold underline underline-offset-4">{r.plate} · {r.jobNumber}</Link> : null}
        {r.lpo ? <span className="text-xs text-muted">{r.lpo}</span> : null}
        <span className={`ml-auto text-xs font-bold ${red ? "text-red" : "text-muted"}`}>{red ? `Expected ${formatDate(r.expected)}, not here` : formatDate(r.expected)}</span>
        {red ? chase(r) : null}
      </div>
      {r.partId ? (
        <details className="text-sm">
          <summary className="cursor-pointer self-start text-xs font-semibold text-muted underline underline-offset-4 min-h-8 inline-flex items-center" data-move-date>Change the expected date</summary>
          <form action={changeExpectedDate.bind(null, r.partId)} className="mt-1 flex flex-wrap items-end gap-2">
            <Input type="date" name="date" defaultValue={r.expected} className="w-40 min-h-9" data-move-date-input />
            <ReasonChips name="reason" label="Why?" rows={1} options={reasons.length ? reasons : ["Supplier delayed", "Back order", "Wrong part came, reordered"]} required placeholder="Tap or type" />
            <Button type="submit" size="md" data-move-date-save>Save</Button>
          </form>
        </details>
      ) : null}
    </li>
  );

  return (
    <>
      <PageHeader title="Parts arrivals" subtitle="What is coming, day by day: supplier, car and LPO. Overdue parts sit on top; one tap moves a date and tells the advisor." />
      <LiveRefresh tables={["purchase_orders", "part_items"]} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form className="flex flex-wrap items-end gap-2">
        <div className="inline-flex overflow-hidden rounded-control border border-line-strong">
          <Link href={`/parts/arrivals?week=this${supplierParam ? `&supplier=${encodeURIComponent(supplierParam)}` : ""}${specialParam === "1" ? "&special=1" : ""}`} className={`min-h-11 inline-flex items-center px-4 text-sm font-bold ${week === "this" ? "bg-ink text-white" : "bg-white"}`}>This week</Link>
          <Link href={`/parts/arrivals?week=next${supplierParam ? `&supplier=${encodeURIComponent(supplierParam)}` : ""}${specialParam === "1" ? "&special=1" : ""}`} className={`min-h-11 inline-flex items-center px-4 text-sm font-bold ${week === "next" ? "bg-ink text-white" : "bg-white"}`}>Next week</Link>
        </div>
        <input type="hidden" name="week" value={week} />
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Supplier<Select name="supplier" defaultValue={supplierParam ?? ""} className="min-w-44"><option value="">Every supplier</option>{suppliers.map((s) => <option key={s} value={s}>{s}</option>)}</Select></label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="special" value="1" defaultChecked={specialParam === "1"} className="h-5 w-5 accent-ink" />Special orders only</label>
        <Button type="submit" tone="secondary" size="md">Show</Button>
      </form>
      {overdue.length ? (
        <Card className="flex flex-col gap-2 border-red-bar" data-overdue-list>
          <SectionLabel right={`${overdue.length}`}>Overdue: past the expected date, not received</SectionLabel>
          <ul className="flex flex-col gap-2">{overdue.map((r) => line(r, true))}</ul>
        </Card>
      ) : null}
      {specialParam === "1" ? (
        <Card className="flex flex-col gap-1" data-special-list>
          <SectionLabel right={`${shown.filter((r) => r.expected >= today).length}`}>Special orders, whenever they land</SectionLabel>
          {shown.filter((r) => r.expected >= today).length ? <ul className="flex flex-col divide-y divide-line">{shown.filter((r) => r.expected >= today).sort((a, b) => a.expected.localeCompare(b.expected)).map((r) => line(r))}</ul> : <p className="text-sm text-muted">No special orders open.</p>}
        </Card>
      ) : null}
      {specialParam === "1" ? null : weekDays.map((d) => {
        const dayRows = shown.filter((r) => r.expected === d).sort((a, b) => (a.supplier ?? "").localeCompare(b.supplier ?? ""));
        return (
          <Card key={d} className="flex flex-col gap-1" data-arrival-day={d}>
            <SectionLabel right={dayRows.length ? `${dayRows.length}` : undefined}>{d === today ? `Today · ${formatDate(d)}` : formatDate(d)}</SectionLabel>
            {dayRows.length ? <ul className="flex flex-col divide-y divide-line">{dayRows.map((r) => line(r))}</ul> : <p className="text-sm text-muted">Nothing expected.</p>}
          </Card>
        );
      })}
    </>
  );
}
