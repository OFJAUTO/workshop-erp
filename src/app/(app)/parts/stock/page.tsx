import Link from "next/link";
import { Badge, Button, Card, Empty, Input, LinkButton, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate, formatDayTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { STOCK_ITEM_SELECT, isLow, toStockItem } from "@/lib/stock";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { issueStock } from "../order-actions";
import { adjustStock, countStock, createStockOrder, saveStockItemDetails } from "./actions";

export const dynamic = "force-dynamic";

type OpenJob = { id: string; job_number: string; vehicle: { kind?: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null } | null };
type Movement = { id: string; stock_item_id: string; kind: string; quantity: number | string; unit_cost: number | string | null; quantity_after: number | string; note: string | null; created_at: string; job: { job_number: string } | null; po: { number: string } | null; by: { display_name: string } | null };

const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIND_LABEL: Record<string, string> = { in: "In", out: "Issued", count: "Count", adjust: "Adjusted", return: "Back" };

/**
 * Real stock: the shelf items with their quantity, minimum, reorder quantity and average cost; below the minimum
 * turns red with Reorder; a stock order is an LPO with no job; the monthly count replaces the figures; every
 * movement is listed. Issuing to a job stays as it was (by quantity, the technician's PIN above the limit).
 */
export default async function StockPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; count?: string; order?: string; reorder?: string }> }) {
  await requirePermission("manageStock");
  const { message, error, count, order, reorder } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const [{ data: itemsRaw }, { data: jobs }, { data: techs }, { data: suppliers }, { data: moves }, { data: openOrders }] = await Promise.all([
    admin.from("stock_items").select(STOCK_ITEM_SELECT).eq("is_active", true).order("name"),
    admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)").eq("is_open", true).in("status", ["in_work", "waiting_parts", "pending_qc"]).order("job_number"),
    admin.from("staff").select("id, display_name").eq("role_id", "technician").eq("is_active", true).order("display_name"),
    admin.from("suppliers").select("id, name").eq("is_active", true).order("name"),
    admin.from("stock_movements").select("id, stock_item_id, kind, quantity, unit_cost, quantity_after, note, created_at, job:jobs(job_number), po:purchase_orders(number), by:staff!stock_movements_created_by_fkey(display_name)").eq("is_active", true).order("created_at", { ascending: false }).limit(40),
    admin.from("purchase_orders").select("id, number, supplier_name, status, total_cost_aed").eq("kind", "stock").eq("is_active", true).in("status", ["pending_approval", "approved", "ordered", "partly_received"]).order("created_at", { ascending: false }),
  ]);
  const items = ((itemsRaw ?? []) as Record<string, unknown>[]).map(toStockItem);
  const openJobs = (jobs ?? []) as unknown as OpenJob[];
  const supplierName = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const low = items.filter(isLow);
  const countMode = count === "1";
  const orderMode = order === "1" || !!reorder;
  const reorderItem = reorder ? items.find((i) => i.id === reorder) ?? null : null;
  const lastCount = items.map((i) => i.last_counted_at).filter((x): x is string => !!x).sort().at(-1) ?? null;

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle={`${items.length} item${items.length === 1 ? "" : "s"}${low.length ? ` · ${low.length} below minimum` : ""}${lastCount ? ` · last count ${formatDate(lastCount)}` : " · never counted"}`}
        actions={<><LinkButton href="/parts/stock?order=1" size="lg">Stock order</LinkButton><LinkButton href="/parts/stock?count=1" tone="secondary" size="lg">Monthly count</LinkButton><LinkButton href="/parts" tone="secondary" size="lg">Parts desk</LinkButton></>}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {low.length ? <Notice tone="error">Below minimum: {low.map((i) => `${i.name} (${i.quantity} ${i.unit}, minimum ${i.minimum_level})`).join(" · ")}. Raise a stock order.</Notice> : null}
      {(openOrders ?? []).length ? (
        <Card className="flex flex-col gap-1" data-open-stock-orders>
          <SectionLabel right={`${(openOrders ?? []).length}`}>Stock orders on the go</SectionLabel>
          {(openOrders ?? []).map((o) => <p key={o.id} className="text-sm flex flex-wrap items-center gap-2"><Link href={`/parts/orders/${o.id}`} className="font-semibold underline underline-offset-4">{o.number}</Link><span className="text-muted">{o.supplier_name}</span><Badge tone={o.status === "pending_approval" ? "amber" : "ink"}>{o.status === "pending_approval" ? "Waiting for approval" : o.status === "approved" ? "Approved, to send" : o.status === "ordered" ? "Ordered" : "Partly received"}</Badge><span className="ml-auto text-muted">{money(Number(o.total_cost_aed) || 0)}</span></p>)}
        </Card>
      ) : null}

      {orderMode ? (
        <Card className="flex flex-col gap-3 border-ink" data-stock-order-form>
          <SectionLabel>Stock order</SectionLabel>
          <p className="text-xs text-muted">One supplier, the items and quantities. It goes to the owner or the head accountant for approval like any LPO; the delivery lands on the shelf with the cost averaged in.</p>
          <form action={createStockOrder} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 max-w-sm"><span className="text-xs font-semibold text-muted">Supplier</span>
              <Select name="supplier_id" required defaultValue={reorderItem?.supplier_id ?? ""}><option value="">Choose…</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            </label>
            <ul className="divide-y divide-line">
              {items.map((i) => (
                <li key={i.id} className="py-2 flex flex-wrap items-center gap-3 text-sm" data-order-line={i.id}>
                  <span className="flex-1 min-w-48 font-semibold">{i.name}{i.part_number ? <span className="text-muted font-normal"> · {i.part_number}</span> : null}<span className="block text-xs text-muted font-normal">{i.quantity} {i.unit} on the shelf · minimum {i.minimum_level}{isLow(i) ? " · below minimum" : ""}</span></span>
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted">Qty <Input name={`qty__${i.id}`} inputMode="decimal" defaultValue={reorderItem?.id === i.id && i.reorder_quantity ? String(i.reorder_quantity) : ""} placeholder={i.reorder_quantity ? String(i.reorder_quantity) : "0"} className="w-24" /></label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted">Cost each <Input name={`cost__${i.id}`} inputMode="decimal" placeholder={i.unit_cost.toFixed(2)} className="w-28" /></label>
                </li>
              ))}
            </ul>
            <Input name="notes" placeholder="Note to the supplier (optional)" className="max-w-lg" />
            <div className="flex flex-wrap gap-2"><Button type="submit" size="lg" data-raise-stock-order>Send for approval</Button><LinkButton href="/parts/stock" tone="secondary" size="lg">Cancel</LinkButton></div>
          </form>
        </Card>
      ) : null}

      {countMode ? (
        <Card className="flex flex-col gap-3 border-ink" data-stock-count-form>
          <SectionLabel>Monthly count</SectionLabel>
          <p className="text-xs text-muted">Type what is on the shelf for each item. The figure replaces the stock figure and the difference is written as a count. Leave an item empty to skip it.</p>
          <form action={countStock} className="flex flex-col gap-3">
            <ul className="divide-y divide-line">
              {items.map((i) => (
                <li key={i.id} className="py-2 flex flex-wrap items-center gap-3 text-sm" data-count-line={i.id}>
                  <span className="flex-1 min-w-48 font-semibold">{i.name}<span className="block text-xs text-muted font-normal">system says {i.quantity} {i.unit}{i.last_counted_at ? ` · last counted ${formatDate(i.last_counted_at)}` : ""}</span></span>
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted">Counted <Input name={`counted__${i.id}`} inputMode="decimal" className="w-28" /></label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2"><Button type="submit" size="lg" data-save-count>Save the count</Button><LinkButton href="/parts/stock" tone="secondary" size="lg">Cancel</LinkButton></div>
          </form>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <SectionLabel right={`${items.length}`}>Items</SectionLabel>
            {items.length === 0 ? <Empty title="No stock items yet" /> : null}
            <ul className="divide-y divide-line">
              {items.map((i) => (
                <li key={i.id} className={`py-2 flex flex-col gap-1 ${isLow(i) ? "bg-red-soft/40 -mx-2 px-2 rounded-control" : ""}`} data-stock-item={i.id} data-low={isLow(i) ? "1" : undefined}>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-semibold">{i.name}</span>
                    {i.part_number ? <span className="text-xs text-muted">{i.part_number}</span> : null}
                    <span className={`font-extrabold ${isLow(i) ? "text-red" : ""}`} data-stock-qty>{i.quantity} {i.unit}</span>
                    <span className="text-xs text-muted">minimum {i.minimum_level} · reorder {i.reorder_quantity || "–"} · avg cost {money(i.unit_cost)} · worth {money(i.quantity * i.unit_cost)}</span>
                    {i.supplier_id ? <span className="text-xs text-muted">{supplierName.get(i.supplier_id)}</span> : null}
                    {isLow(i) ? <Badge tone="red">Below minimum</Badge> : null}
                    {isLow(i) ? <LinkButton href={`/parts/stock?reorder=${i.id}`} size="md" data-reorder={i.id}>Reorder</LinkButton> : null}
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer min-h-9 flex items-center font-semibold text-muted">Edit the item or adjust the figure</summary>
                    <div className="flex flex-col gap-2 pt-1">
                      <form action={saveStockItemDetails} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={i.id} />
                        <label className="flex flex-col gap-1 flex-1 min-w-40"><span className="font-semibold text-muted">Item</span><Input name="name" defaultValue={i.name} /></label>
                        <label className="flex flex-col gap-1"><span className="font-semibold text-muted">Part number</span><Input name="part_number" defaultValue={i.part_number ?? ""} className="w-36" textCase="upper" /></label>
                        <label className="flex flex-col gap-1"><span className="font-semibold text-muted">Unit</span><Input name="unit" defaultValue={i.unit} className="w-16" /></label>
                        <label className="flex flex-col gap-1"><span className="font-semibold text-muted">Minimum</span><Input name="minimum_level" defaultValue={String(i.minimum_level)} inputMode="decimal" className="w-20" /></label>
                        <label className="flex flex-col gap-1"><span className="font-semibold text-muted">Reorder qty</span><Input name="reorder_quantity" defaultValue={String(i.reorder_quantity)} inputMode="decimal" className="w-20" /></label>
                        <label className="flex flex-col gap-1"><span className="font-semibold text-muted">Supplier</span><Select name="supplier_id" defaultValue={i.supplier_id ?? ""} className="w-40"><option value="">–</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
                        <Button type="submit" tone="secondary" size="md">Save</Button>
                      </form>
                      <form action={adjustStock} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={i.id} />
                        <label className="flex flex-col gap-1"><span className="font-semibold text-muted">Change (minus takes off)</span><Input name="delta" inputMode="decimal" placeholder="-2" className="w-24" /></label>
                        <label className="flex flex-col gap-1 flex-1 min-w-48"><span className="font-semibold text-muted">Why</span><Input name="note" placeholder="Spilled, miscounted, …" /></label>
                        <Button type="submit" tone="secondary" size="md">Adjust</Button>
                      </form>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="flex flex-col gap-3">
            <SectionLabel>New item</SectionLabel>
            <form action={saveStockItemDetails} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 flex-1 min-w-48"><span className="text-xs font-semibold text-muted">Item</span><Input name="name" required placeholder="For example: Engine oil 5W-40, 1 L" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Part number</span><Input name="part_number" className="w-36" textCase="upper" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Unit</span><Input name="unit" defaultValue="pc" className="w-16" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Opening qty</span><Input name="quantity" defaultValue="0" inputMode="decimal" className="w-24" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cost each</span><Input name="unit_cost" defaultValue="0" inputMode="decimal" className="w-24" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Minimum</span><Input name="minimum_level" defaultValue="0" inputMode="decimal" className="w-20" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Reorder qty</span><Input name="reorder_quantity" defaultValue="0" inputMode="decimal" className="w-20" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Supplier</span><Select name="supplier_id" defaultValue="" className="w-40"><option value="">–</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
              <Button type="submit" size="md" data-add-stock-item>Add item</Button>
            </form>
          </Card>
          <Card className="flex flex-col gap-2">
            <SectionLabel right={`${(moves ?? []).length}`}>Movements</SectionLabel>
            {(moves ?? []).length === 0 ? <p className="text-sm text-muted">Nothing moved yet.</p> : null}
            <ul className="divide-y divide-line text-sm">
              {((moves ?? []) as unknown as Movement[]).map((m) => (
                <li key={m.id} className="py-1.5 flex flex-wrap items-center gap-2" data-movement={m.kind}>
                  <span className="text-xs text-muted w-28">{formatDayTime(m.created_at)}</span>
                  <Badge tone={m.kind === "in" || m.kind === "return" ? "green" : m.kind === "out" ? "ink" : "neutral"}>{KIND_LABEL[m.kind] ?? m.kind}</Badge>
                  <span className="font-semibold">{itemName.get(m.stock_item_id) ?? ""}</span>
                  <span>{Number(m.quantity) > 0 ? "+" : ""}{Number(m.quantity)} → {Number(m.quantity_after)}</span>
                  {m.unit_cost !== null && (m.kind === "in" || m.kind === "return") ? <span className="text-xs text-muted">at {money(Number(m.unit_cost))}</span> : null}
                  <span className="text-xs text-muted">{m.job?.job_number ?? m.po?.number ?? ""}{m.note ? ` · ${m.note}` : ""}{m.by ? ` · ${m.by.display_name}` : ""}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card className="flex flex-col gap-3 border-ink">
          <SectionLabel>Issue to a job</SectionLabel>
          <form action={issueStock} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Item</span>
              <Select name="stock_item" required><option value="">Choose…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.quantity} {i.unit})</option>)}</Select>
            </label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Job</span>
              <Select name="job" required><option value="">Choose…</option>{openJobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.vehicle ? formatPlate(j.vehicle) : ""}</option>)}</Select>
            </label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input name="quantity" inputMode="decimal" required /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Technician</span>
              <Select name="technician" required><option value="">Choose…</option>{(techs ?? []).map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}</Select>
            </label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Technician&apos;s PIN <span className="font-medium">(needed above AED {Number(settings.pin_needed_above_aed) || 0})</span></span><Input name="pin" inputMode="numeric" maxLength={4} className="max-w-32" /></label>
            <Button type="submit" size="md">Issue</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
