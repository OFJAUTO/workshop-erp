import { ApprovalsHere } from "@/components/ApprovalsHere";
import Link from "next/link";
import { loadReversals, reversalsReady, reversible } from "@/lib/stock-reversals";
import { archiveStockItemAction, askReversalAction, decideReversalAction } from "./reversal-actions";
import { Badge, Button, Card, ChoiceButtons, Empty, Input, LinkButton, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { refuse } from "@/lib/refusal";
import { STOCK_EXTRA_SELECT, loadCategories, loadCount, openCount, stockAccessOf, stockCountsReady, stockRedesignReady } from "@/lib/stock-manage";
import { STOCK_SORTS, filterStock, isPlaceholderStockNumber, pageOf, sortStock, stockStatusOf, stockTiles, valueWords, type StockFilter, type StockSort } from "@/lib/stock-rules";
import { signJobFiles } from "@/lib/work-data";
import { StockList, type StockRow } from "./StockList";
import { StockCountForm } from "./StockCountForm";
import { CategoriesBox, LabelsPicker } from "./StockExtras";
import { archiveItemAction, mergeItemsAction, saveStockPhotoAction, startCountFromPage } from "./manage-actions";
import { STOCK_UNITS as STOCK_UNIT_LIST } from "@/lib/stock-rules";
import { formatDate, formatDayTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { ITEM_TYPE_LABELS, STOCK_ITEM_SELECT, isLow, toStockItem } from "@/lib/stock";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { issueStock } from "../order-actions";
import { adjustStock, countStock, createStockOrder, saveStockItemDetails } from "./actions";
import { pickablePeople } from "@/lib/staff-picker";
import { groupByTeam } from "@/lib/teams";

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
export default async function StockPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; count?: string; order?: string; reorder?: string; approval?: string; q?: string; status?: string; cat?: string; brand?: string; sort?: string; dir?: string; page?: string; item?: string; view?: string }> }) {
  const staff = await requireStaff();
  const access = await stockAccessOf(staff);
  if (!access.view) return refuse("no_permission");
  const sp = await searchParams;
  const { message, error, count, order, reorder, approval } = sp;
  const admin = createAdminClient();
  const settings = await getSettings();
  const [{ data: itemsRaw }, { data: jobs }, { data: techs }, { data: suppliers }, { data: moves }, { data: openOrders }] = await Promise.all([
    admin.from("stock_items").select((STOCK_ITEM_SELECT + ((await stockRedesignReady()) ? STOCK_EXTRA_SELECT : "")) as typeof STOCK_ITEM_SELECT).eq("is_active", true).order("name"),
    admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)").eq("is_open", true).in("status", ["in_work", "waiting_parts", "pending_qc"]).order("job_number"),
    pickablePeople(settings, ["mechanical", "bodyshop"]).then((data) => ({ data })),
    admin.from("suppliers").select("id, name").eq("is_active", true).order("name"),
    admin.from("stock_movements").select("id, stock_item_id, kind, quantity, unit_cost, quantity_after, note, created_at, job:jobs(job_number), po:purchase_orders(number), by:staff!stock_movements_created_by_fkey(display_name)").eq("is_active", true).order("created_at", { ascending: false }).limit(40),
    admin.from("purchase_orders").select("id, number, supplier_name, status, total_cost_aed").eq("kind", "stock").eq("is_active", true).in("status", ["pending_approval", "approved", "ordered", "partly_received"]).order("created_at", { ascending: false }),
  ]);
  const items = ((itemsRaw ?? []) as Record<string, unknown>[]).map(toStockItem);
  // Reverse a mistaken entry (10 November 2026, Section 8): the requests, the owner's decisions and every open job to move stock to.
  const reversalsOn = await reversalsReady();
  const reversals = await loadReversals();
  const reversalOf = (movementId: string) => reversals.find((r) => r.movement_id === movementId && r.status !== "refused") ?? null;
  const isOwner = staff.role_id === "owner" && !staff.viewingAs;
  const { data: allOpen } = reversalsOn ? await admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)").eq("is_open", true).order("job_number", { ascending: false }).limit(300) : { data: [] };
  const moveJobs = (allOpen ?? []) as unknown as OpenJob[];
  const pendingReversals = reversals.filter((r) => r.status === "pending");
  const openJobs = (jobs ?? []) as unknown as OpenJob[];
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const low = items.filter(isLow);
  const countMode = count === "1";
  const orderMode = order === "1" || !!reorder;
  const reorderItem = reorder ? items.find((i) => i.id === reorder) ?? null : null;
  const lastCount = items.map((i) => i.last_counted_at).filter((x): x is string => !!x).sort().at(-1) ?? null;
  // 20 November 2026 (Section 5): THE stock page - four tiles, search and filters, one row per item, a side panel.
  const manage = access.manage && !staff.viewingAs;
  const categories = await loadCategories();
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const view = sp.view === "categories" || sp.view === "labels" ? sp.view : "items";
  const statusRaw = String(sp.status ?? "all");
  const filter: StockFilter = { q: String(sp.q ?? ""), status: (["in", "low", "out", "nomin", "placeholder"].includes(statusRaw) ? statusRaw : "all") as StockFilter["status"], category: String(sp.cat ?? ""), brand: String(sp.brand ?? "") };
  const sortKey: StockSort = (STOCK_SORTS as readonly string[]).includes(String(sp.sort)) && (access.seesCost || sp.sort !== "cost") ? (sp.sort as StockSort) : "name";
  const desc = sp.dir === "desc";
  const lite = items.map((i) => ({ ...i, category_id: ((i as unknown as Record<string, unknown>).category_id as string | null) ?? null, brand: ((i as unknown as Record<string, unknown>).brand as string | null) ?? null, photo_path: ((i as unknown as Record<string, unknown>).photo_path as string | null) ?? null }));
  const tiles = stockTiles(lite);
  const shownAll = sortStock(filterStock(lite, filter), sortKey, desc, (id) => (id ? catName.get(id) ?? "" : ""));
  const paged = pageOf(shownAll, Number(sp.page) || 1);
  const photos = await signJobFiles(paged.rows.map((r) => r.photo_path).filter((x): x is string => !!x));
  const rows: StockRow[] = paged.rows.map((i) => ({ id: i.id, name: i.name, partNumber: i.part_number, placeholder: isPlaceholderStockNumber(i.part_number), categoryId: i.category_id, categoryName: i.category_id ? catName.get(i.category_id) ?? null : null, brand: i.brand, quantity: i.quantity, unit: i.unit, minimum: i.minimum_level, reorderQty: i.reorder_quantity, status: stockStatusOf(i), itemType: i.item_type, supplierId: i.supplier_id, photoUrl: i.photo_path ? photos[i.photo_path] ?? null : null, ...(access.seesCost ? { cost: i.unit_cost } : {}) }));
  const brands = Array.from(new Set(lite.map((i) => i.brand).filter((x): x is string => !!x))).sort();
  const qs = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string> = { q: filter.q, status: filter.status === "all" ? "" : filter.status, cat: filter.category, brand: filter.brand, sort: sortKey === "name" ? "" : sortKey, dir: desc ? "desc" : "", view: view === "items" ? "" : view };
    for (const [k, v] of Object.entries({ ...cur, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return `/parts/stock${s ? `?${s}` : ""}`;
  };
  const sortHrefs = Object.fromEntries((["name", "qty", "cost", "status", "category"] as const).map((c) => [c, qs({ sort: c === "name" ? null : c, dir: sortKey === c && !desc ? "desc" : null, page: null })]));
  const tile = (key: string, label: string, n: number, tone = "") => (
    <a href={qs({ status: key === "all" ? null : key, page: null })} className={`flex min-h-16 flex-col justify-center rounded-card border bg-white px-4 py-3 ${filter.status === key || (key === "all" && filter.status === "all") ? "border-ink" : "border-line"}`} data-stock-tile={key}>
      <span className="text-xs font-semibold uppercase text-muted">{label}</span>
      <span className={`text-2xl font-extrabold ${tone}`} data-stock-tile-count>{n}</span>
    </a>
  );
  // The stock count (applied only when the owner approves the batch).
  const countsOn = await stockCountsReady();
  const current = countsOn ? await openCount() : null;
  const countView = !countsOn ? null : count && count !== "1" ? await loadCount(count) : current ? await loadCount(current.id) : null;
  const countLines = countView ? new Map(countView.lines.map((l) => [l.itemId, l])) : new Map();
  const techGroups = groupByTeam(techs ?? [], ["mechanical", "bodyshop"]).map((g) => ({ label: g.team.label, members: g.members.map((t) => ({ id: t.id, name: t.display_name })) }));

  return (
    <>
      <ApprovalsHere staff={staff} highlight={approval ?? null} kinds={["stock_reversal", "stock_count"]} />
      <PageHeader
        title="Stock"
        subtitle={`${items.length} item${items.length === 1 ? "" : "s"}${low.length ? ` · ${low.length} low` : ""}${lastCount ? ` · last count ${formatDate(lastCount)}` : " · never counted"}${manage ? "" : " · view only"}`}
        actions={manage ? <><LinkButton href="/parts/stock?view=items&add=1#add" size="lg" data-add-stock-open>+ Add stock item</LinkButton><LinkButton href={qs({ view: "categories" })} tone="secondary" size="lg" data-manage-categories>Manage categories</LinkButton><LinkButton href={countsOn ? `/parts/stock?count=${current?.id ?? "1"}` : "/parts/stock?count=1"} tone="secondary" size="lg" data-stock-count-open>{current ? "Continue the count" : "Stock count"}</LinkButton><LinkButton href="/parts/stock?order=1" tone="secondary" size="lg" data-new-workshop-order>New workshop order</LinkButton><LinkButton href={qs({ view: "labels" })} tone="ghost" size="lg" data-stock-labels-tab>Labels</LinkButton>{["owner", "accounts"].includes(staff.role_id) ? <LinkButton href="/stock-report" tone="ghost" size="lg">Stock report</LinkButton> : null}</> : undefined}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {manage && (openOrders ?? []).length ? (
        <Card className="flex flex-col gap-1" data-open-stock-orders>
          <SectionLabel right={`${(openOrders ?? []).length}`}>Stock orders on the go</SectionLabel>
          {(openOrders ?? []).map((o) => <p key={o.id} className="text-sm flex flex-wrap items-center gap-2"><Link href={`/parts/orders/${o.id}`} className="font-semibold underline underline-offset-4">{o.number}</Link><span className="text-muted">{o.supplier_name} · {o.status.replace(/_/g, " ")}</span></p>)}
        </Card>
      ) : null}
      {manage && orderMode ? (
        <Card className="flex flex-col gap-3 border-ink" data-stock-order-form>
          <SectionLabel>New workshop order</SectionLabel>
          <p className="text-xs text-muted">One supplier, what kind of goods, the items and quantities. It goes to the owner or the head accountant for approval like any LPO; stock parts and consumables land on the shelf at delivery with the cost averaged in; tools and equipment at or above AED {(Number(settings.fixed_asset_threshold_aed) || 2000).toLocaleString("en-GB")} are flagged for accounts as a fixed asset.</p>
          <style>{`.wo-form:has(input[name="order_type"][value="tools"]:checked) .wo-stock { display: none } .wo-form:not(:has(input[name="order_type"][value="tools"]:checked)) .wo-tools { display: none } .wo-form:has(input[name="order_type"][value="consumables"]:checked) .wo-item-part { display: none } .wo-form:has(input[name="order_type"][value="stock_parts"]:checked) .wo-item-consumable { display: none }`}</style>
          <form action={createStockOrder} className="flex flex-col gap-3 wo-form">
            <ChoiceButtons name="order_type" columns={3} defaultValue={reorderItem?.item_type === "consumable" ? "consumables" : "stock_parts"} options={[{ value: "stock_parts", label: "Stock parts" }, { value: "consumables", label: "Workshop consumables" }, { value: "tools", label: "Tools and equipment", hint: "fixed asset above the Settings amount" }]} />
            <label className="flex flex-col gap-1 max-w-sm"><span className="text-xs font-semibold text-muted">Supplier</span>
              <Select name="supplier_id" required defaultValue={reorderItem?.supplier_id ?? ""}><option value="">Choose…</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            </label>
            <ul className="divide-y divide-line wo-stock">
              {items.map((i) => (
                <li key={i.id} className={`py-2 flex flex-wrap items-center gap-3 text-sm wo-item-${i.item_type}`} data-order-line={i.id}>
                  <span className="flex-1 min-w-48 font-semibold">{i.name}{i.part_number ? <span className="text-muted font-normal"> · {i.part_number}</span> : null}<span className="block text-xs text-muted font-normal">{i.quantity} {i.unit} on the shelf · minimum {i.minimum_level}{isLow(i) ? " · below minimum" : ""}</span></span>
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted">Qty <Input name={`qty__${i.id}`} inputMode="decimal" defaultValue={reorderItem?.id === i.id && i.reorder_quantity ? String(i.reorder_quantity) : ""} placeholder={i.reorder_quantity ? String(i.reorder_quantity) : "0"} className="w-24" /></label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted">Cost each <Input name={`cost__${i.id}`} inputMode="decimal" placeholder={i.unit_cost.toFixed(2)} className="w-28" /></label>
                </li>
              ))}
            </ul>
            <ul className="divide-y divide-line wo-tools" data-tools-lines>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <li key={n} className="py-2 flex flex-wrap items-center gap-3 text-sm">
                  <Input name={`tool_desc__${n}`} placeholder={`Tool or equipment ${n}`} className="flex-1 min-w-48" />
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted">Qty <Input name={`tool_qty__${n}`} inputMode="decimal" className="w-20" /></label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted">Cost each <Input name={`tool_cost__${n}`} inputMode="decimal" className="w-28" /></label>
                </li>
              ))}
            </ul>
            <Input name="notes" placeholder="Note to the supplier (optional)" className="max-w-lg" />
            <div className="flex flex-wrap gap-2"><Button type="submit" size="lg" data-raise-stock-order>Send for approval</Button><LinkButton href="/parts/stock" tone="secondary" size="lg">Cancel</LinkButton></div>
          </form>
        </Card>
      ) : null}


      {manage && countMode && !countsOn ? (
        <>
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
              </>
      ) : null}
      {manage && countsOn && (countMode || (count && count !== "1")) ? (
        <Card className="flex flex-col gap-3 border-ink scroll-mt-4" id="count" data-stock-count>
          <SectionLabel right={countView ? countView.status : undefined}>{countView?.label ?? "Stock count"}</SectionLabel>
          {!countView ? (
            <form action={startCountFromPage} className="flex flex-wrap items-center gap-2"><Button type="submit" size="lg" data-count-start>Start the count</Button><span className="text-xs text-muted">Enter item by item; save and continue another day. Nothing changes until the owner approves it.</span></form>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm" data-count-summary>
                <span className="flex flex-col"><span className="text-xs font-semibold uppercase text-muted">Counted</span><span className="font-extrabold">{countView.diff.counted}</span></span>
                <span className="flex flex-col"><span className="text-xs font-semibold uppercase text-muted">Change</span><span className="font-extrabold">{countView.diff.changed}</span></span>
                <span className="flex flex-col"><span className="text-xs font-semibold uppercase text-muted">Not found</span><span className="font-extrabold">{countView.diff.notFound}</span></span>
                <span className="flex flex-col"><span className="text-xs font-semibold uppercase text-muted">Total change</span><span className="font-extrabold" data-count-total>{valueWords(countView.diff.totalValue)}</span></span>
              </div>
              {countView.diff.lines.filter((l) => Math.abs(l.diff) > 0.0005).length ? (
                <ul className="divide-y divide-line text-sm" data-count-diffs>
                  {countView.diff.lines.filter((l) => Math.abs(l.diff) > 0.0005).map((l) => <li key={l.itemId} className="flex flex-wrap justify-between gap-2 py-1" data-count-diff={l.itemId}><span className="font-semibold uppercase">{l.name}</span><span>{l.notFound ? "not found (archived)" : `${l.systemQty} → ${l.countedQty} ${l.unit}`} · {l.diff > 0 ? "+" : ""}{l.diff} · {valueWords(l.value)}</span></li>)}
                </ul>
              ) : null}
              <StockCountForm countId={countView.id} submitted={countView.status !== "draft"} lines={items.map((i) => { const c = countLines.get(i.id); return { id: i.id, name: i.name, unit: i.unit, partNumber: i.part_number, systemQty: i.quantity, counted: c && c.countedQty !== null ? String(c.countedQty) : "", notFound: !!c?.notFound }; })} />
            </>
          )}
        </Card>
      ) : null}

      {view === "categories" ? (
        <Card className="flex flex-col gap-3" data-categories>
          <SectionLabel right={`${categories.length}`}>Categories</SectionLabel>
          {categories.length ? <CategoriesBox categories={categories.map((c) => ({ id: c.id, name: c.name }))} canEdit={manage && (staff.role_id === "owner" || staff.role_id === "parts")} /> : <p className="text-sm text-muted">Categories switch on once the database change is applied (WAITING FOR APPLY).</p>}
        </Card>
      ) : null}
      {view === "labels" && manage ? (
        <Card className="flex flex-col gap-3" data-labels>
          <SectionLabel>Shelf labels</SectionLabel>
          <LabelsPicker items={shownAll.map((i) => ({ id: i.id, name: i.name, partNumber: i.part_number }))} />
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-stock-tiles>
        {tile("all", "Total items", tiles.total)}
        {tile("in", "In stock", tiles.in, "text-green-text")}
        {tile("low", "Low stock", tiles.low, "text-amber-text")}
        {tile("out", "Out of stock", tiles.out, "text-red")}
      </div>
      <Card className="flex flex-col gap-3">
        <form action="/parts/stock" className="flex flex-wrap items-end gap-2" data-stock-filters>
          {filter.status !== "all" ? <input type="hidden" name="status" value={filter.status} /> : null}
          <label className="flex min-w-48 flex-1 flex-col gap-1"><span className="text-xs font-semibold text-muted">Search</span><Input name="q" defaultValue={filter.q} placeholder="Name or part number" spell={false} data-stock-search /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Category</span><Select name="cat" defaultValue={filter.category} className="w-48" data-stock-filter-cat><option value="">All</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Brand</span><Select name="brand" defaultValue={filter.brand} className="w-40" data-stock-filter-brand><option value="">All</option>{brands.map((b) => <option key={b} value={b}>{b}</option>)}</Select></label>
          <Button type="submit" size="md">Show</Button>
          <Link href="/parts/stock" className="inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4">Clear</Link>
        </form>
        <div className="flex flex-wrap gap-2 text-sm" data-stock-cleanup>
          <a href={qs({ status: "nomin", page: null })} className={`rounded-control border px-3 py-1.5 font-semibold ${filter.status === "nomin" ? "border-ink" : "border-line"}`} data-stock-filter-nomin>No minimum set ({lite.filter((i) => !(i.minimum_level > 0)).length})</a>
          <a href={qs({ status: "placeholder", page: null })} className={`rounded-control border px-3 py-1.5 font-semibold ${filter.status === "placeholder" ? "border-ink" : "border-line"}`} data-stock-filter-placeholder>Placeholder part numbers ({lite.filter((i) => isPlaceholderStockNumber(i.part_number)).length})</a>
        </div>
        <span className="text-xs text-muted" data-stock-paging>{paged.words}</span>
        {rows.length ? (
          <StockList rows={rows} manage={manage} seesCost={access.seesCost} categories={categories.map((c) => ({ id: c.id, name: c.name }))} suppliers={(suppliers ?? []).map((s) => ({ id: s.id as string, name: s.name as string }))} jobs={openJobs.map((j) => ({ id: j.id, label: `${j.job_number} · ${j.vehicle ? formatPlate(j.vehicle) : ""}` }))} techs={techGroups} others={items.map((i) => ({ id: i.id, name: i.name }))} pinAbove={Number(settings.pin_needed_above_aed) || 0} openId={sp.item ?? null} sortHrefs={sortHrefs} issue={issueStock} adjust={adjustStock} saveItem={saveStockItemDetails} archive={archiveItemAction} merge={mergeItemsAction} photo={saveStockPhotoAction} quickArchive={archiveStockItemAction} />
        ) : <Empty title="No stock item matches" />}
        {paged.pages > 1 ? (
          <div className="flex flex-wrap items-center gap-2" data-stock-pages>
            {paged.page > 1 ? <LinkButton href={qs({ page: String(paged.page - 1) })} tone="secondary" size="md">Previous</LinkButton> : null}
            <span className="text-sm">Page {paged.page} of {paged.pages}</span>
            {paged.page < paged.pages ? <LinkButton href={qs({ page: String(paged.page + 1) })} tone="secondary" size="md">Next</LinkButton> : null}
          </div>
        ) : null}
      </Card>

      {manage ? (
        <Card className="flex flex-col gap-3 scroll-mt-4" id="add">
          <SectionLabel>+ Add stock item</SectionLabel>
          <form action={saveStockItemDetails} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 flex-1 min-w-48"><span className="text-xs font-semibold text-muted">Item</span><Input name="name" required placeholder="For example: Engine oil 5W-40, 1 L" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Part number</span><Input name="part_number" className="w-36" textCase="upper" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Brand</span><Input name="brand" className="w-32" spell={false} /></label>
            {categories.length ? <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Category</span><Select name="category_id" defaultValue="" className="w-48"><option value="">–</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label> : null}
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Kind</span><Select name="item_type" defaultValue="part" className="w-36" data-new-item-type>{(["part", "consumable"] as const).map((t) => <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>)}</Select></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Unit</span><Select name="unit" defaultValue="pc" className="w-24" data-new-item-unit>{STOCK_UNIT_LIST.map((u) => <option key={u} value={u}>{u}</option>)}</Select></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Opening qty</span><Input name="quantity" defaultValue="0" inputMode="decimal" className="w-24" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cost each</span><Input name="unit_cost" defaultValue="0" inputMode="decimal" className="w-24" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Minimum</span><Input name="minimum_level" defaultValue="0" inputMode="decimal" className="w-20" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Reorder qty</span><Input name="reorder_quantity" defaultValue="0" inputMode="decimal" className="w-20" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Supplier</span><Select name="supplier_id" defaultValue="" className="w-40"><option value="">–</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
            <Button type="submit" size="md" data-add-stock-item>Add item</Button>
          </form>
        </Card>
      ) : null}

      {manage ? (
        <div className="flex flex-col gap-4">
          {reversalsOn ? (
            <Card className={`flex flex-col gap-2 scroll-mt-4 ${pendingReversals.length ? "border-2 border-amber-bar" : ""}`} id="reversals" data-stock-reversals>
              <SectionLabel right={pendingReversals.length ? `${pendingReversals.length} waiting` : undefined}>Reversed entries</SectionLabel>
              {message || error ? <p className={`text-sm font-semibold ${error ? "text-red" : "text-green-text"}`} data-reversal-answer>{error ?? message}</p> : null}
              {reversals.length === 0 ? <p className="text-sm text-muted">No entry reversed. On a wrong entry below: &quot;Reverse this entry&quot;.</p> : null}
              <ul className="divide-y divide-line text-sm">
                {reversals.slice(0, 20).map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 py-2" data-reversal={r.status}>
                    <span><span className="font-semibold">{itemName.get(r.stock_item_id) ?? "Item"} +{r.quantity}</span> · {r.kind === "move_to_job" ? `move to ${moveJobs.find((j) => j.id === r.job_id)?.job_number ?? "a job"}` : "reverse"} · {r.reason}</span>
                    <span className="text-xs text-muted">{r.status === "pending" ? "Waiting for the owner" : r.status === "approved" ? `Approved${r.decided_at ? ` ${formatDayTime(r.decided_at)}` : ""}` : "Refused"}{r.decision_note ? ` · ${r.decision_note}` : ""}</span>
                    {r.status === "pending" && isOwner ? (
                      <form action={decideReversalAction.bind(null, r.id)} className="flex flex-wrap items-center gap-2" data-reversal-decide>
                        <Input name="note" placeholder="Note (optional)" className="min-w-[12rem] flex-1" textCase="sentence" />
                        <Button type="submit" name="decision" value="approve" size="md" data-reversal-approve>Approve</Button>
                        <Button type="submit" name="decision" value="refuse" tone="secondary" size="md" data-reversal-refuse>Refuse</Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
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
                  {reversalsOn && reversalOf(m.id) ? <Badge tone={reversalOf(m.id)!.status === "approved" ? "neutral" : "amber"}>{reversalOf(m.id)!.status === "approved" ? "Reversed" : "Waiting for owner"}</Badge> : null}
                  {reversalsOn && !reversalOf(m.id) && reversible(m) && !staff.viewingAs ? (
                    <details className="basis-full" data-reverse-entry={m.id}>
                      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center text-xs font-bold underline underline-offset-4 [&::-webkit-details-marker]:hidden">Reverse this entry</summary>
                      <form action={askReversalAction.bind(null, m.id)} className="mt-1 flex flex-col gap-2 rounded-control border border-line bg-white p-2">
                        <label className="flex items-center gap-2 text-sm"><input type="radio" name="kind" value="reverse" defaultChecked className="h-5 w-5 accent-ink" />Reverse it (entered by mistake)</label>
                        <label className="flex flex-wrap items-center gap-2 text-sm"><input type="radio" name="kind" value="move_to_job" className="h-5 w-5 accent-ink" />Move to a job instead (it was bought for a car)
                          <Select name="job_id" className="w-56" data-reverse-job><option value="">Pick the job…</option>{moveJobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.vehicle ? formatPlate(j.vehicle) : ""}</option>)}</Select>
                        </label>
                        <Input name="reason" required minLength={5} placeholder="Why? e.g. entered by mistake" textCase="sentence" data-reverse-reason />
                        <Button type="submit" size="md" className="self-start" data-reverse-send>Send to the owner</Button>
                      </form>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </>
  );
}
