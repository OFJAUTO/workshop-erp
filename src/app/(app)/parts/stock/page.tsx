import { Badge, Button, Card, Empty, Input, LinkButton, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { issueStock, saveStockItem } from "../order-actions";

export const dynamic = "force-dynamic";

type Item = { id: string; name: string; unit: string; quantity: number | string; minimum_level: number | string; unit_cost: number | string };
type OpenJob = { id: string; job_number: string; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null } | null };

/** A simple stock list for consumables: item, quantity, minimum level; issued to a job by quantity with the technician's PIN. */
export default async function StockPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("manageStock");
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const [{ data: items }, { data: jobs }, { data: techs }] = await Promise.all([
    admin.from("stock_items").select("id, name, unit, quantity, minimum_level, unit_cost").eq("is_active", true).order("name"),
    admin.from("jobs").select("id, job_number, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)").eq("is_open", true).in("status", ["in_work", "waiting_parts", "approved", "pending_qc"]).order("job_number"),
    admin.from("staff").select("id, display_name").eq("role_id", "technician").eq("is_active", true).order("display_name"),
  ]);
  const list = (items ?? []) as Item[];
  const openJobs = (jobs ?? []) as unknown as OpenJob[];
  return (
    <>
      <PageHeader title="Consumables stock" subtitle="Oils, fluids, clips and the like. Below the minimum level turns red. Issued to a job by quantity, confirmed by the technician's PIN." actions={<LinkButton href="/parts" tone="secondary" size="lg">Parts desk</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <SectionLabel right={`${list.length}`}>Items</SectionLabel>
            {list.length === 0 ? <Empty title="No stock items yet" /> : null}
            <ul className="divide-y divide-line">
              {list.map((i) => {
                const low = Number(i.quantity) <= Number(i.minimum_level);
                return (
                  <li key={i.id} className="py-2">
                    <form action={saveStockItem} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={i.id} />
                      <label className="flex flex-col gap-1 flex-1 min-w-48"><span className="text-xs font-semibold text-muted">Item</span><Input name="name" defaultValue={i.name} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Unit</span><Input name="unit" defaultValue={i.unit} className="w-20" /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input name="quantity" defaultValue={String(i.quantity)} inputMode="decimal" className={`w-24 ${low ? "border-red-bar" : ""}`} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Minimum</span><Input name="minimum_level" defaultValue={String(i.minimum_level)} inputMode="decimal" className="w-24" /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cost each (AED)</span><Input name="unit_cost" defaultValue={String(i.unit_cost)} inputMode="decimal" className="w-28" /></label>
                      {low ? <Badge tone="red">Below minimum</Badge> : null}
                      <Button type="submit" tone="secondary" size="md">Save</Button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card className="flex flex-col gap-3">
            <SectionLabel>New item</SectionLabel>
            <form action={saveStockItem} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 flex-1 min-w-48"><span className="text-xs font-semibold text-muted">Item</span><Input name="name" required placeholder="For example: Engine oil 5W-40" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Unit</span><Input name="unit" defaultValue="pc" className="w-20" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input name="quantity" defaultValue="0" inputMode="decimal" className="w-24" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Minimum</span><Input name="minimum_level" defaultValue="0" inputMode="decimal" className="w-24" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cost each (AED)</span><Input name="unit_cost" defaultValue="0" inputMode="decimal" className="w-28" /></label>
              <Button type="submit" size="md">Add item</Button>
            </form>
          </Card>
        </div>
        <Card className="flex flex-col gap-3 border-ink">
          <SectionLabel>Issue to a job</SectionLabel>
          <form action={issueStock} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Item</span>
              <Select name="stock_item" required><option value="">Choose…</option>{list.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.quantity} {i.unit})</option>)}</Select>
            </label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Job</span>
              <Select name="job" required><option value="">Choose…</option>{openJobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.vehicle ? formatPlate(j.vehicle) : ""}</option>)}</Select>
            </label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input name="quantity" inputMode="decimal" required /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Technician</span>
              <Select name="technician" required><option value="">Choose…</option>{(techs ?? []).map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}</Select>
            </label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Technician&apos;s PIN <span className="font-medium">(needed above AED {Number(settings.pin_needed_above_aed) || 0})</span></span><Input name="pin" type="password" inputMode="numeric" maxLength={4} className="w-28 text-center tracking-[0.4em]" /></label>
            <Button type="submit" size="md">Issue</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
