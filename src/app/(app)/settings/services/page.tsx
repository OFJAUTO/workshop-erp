import { ServicePriceField } from "./ServicePriceField";
import { Badge, Button, Card, Empty, Field, Input, LinkButton, Notice, PageHeader, SectionLabel, Select, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { loadServices } from "@/lib/quote-data";
import { aed, hoursText, type Service, type ServiceCategory } from "@/lib/quotes";
import { addCategory, addService, moveCategory, moveService, removeCategory, removeService, renameCategory, saveService } from "./actions";

export const dynamic = "force-dynamic";

const DEPT_LABELS: Record<string, string> = { mechanical: "Mechanical", bodyshop: "Bodyshop", both: "Both" };

function ServiceFields({ s, categories }: { s: Service | null; categories: ServiceCategory[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Name">
        <Input name="name" defaultValue={s?.name ?? ""} required />
      </Field>
      <Field label="Department">
        <Select name="department" defaultValue={s?.department ?? "mechanical"}>
          {Object.entries(DEPT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
      </Field>
      <ServicePriceField priceAed={s?.price_aed ?? null} defaultHours={s?.default_hours ?? null} pricePer={s?.price_per ?? "job"} usualQuantity={s?.usual_quantity ?? 1} timeAllowance={s?.time_allowance_hours ?? null} />
      <label className="flex items-start gap-3 cursor-pointer text-sm"><input type="checkbox" name="includes_oil_change" defaultChecked={!!s?.includes_oil_change} className="mt-1 h-5 w-5 accent-ink" /><span><span className="font-semibold">Includes an oil change</span><span className="block text-xs text-muted">Jobs with this service need the oil service sticker, and QC checks it.</span></span></label>
      {s ? (
        <Field label="Category">
          <Select name="category_id" defaultValue={s.category_id}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Description for the customer" optional>
        <Textarea name="description" defaultValue={s?.description ?? ""} rows={2} />
      </Field>
      <Field label="Parts to ask for" optional hint="One per line. Sent to the Parts desk as price requests when the service is added to a quotation.">
        <Textarea name="parts_requests" defaultValue={(s?.parts_requests ?? []).join("\n")} rows={2} />
      </Field>
    </div>
  );
}

/** The owner's services list: categories and services behind "Add service" on quotations and estimates. */
export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("manageServices");
  const { message, error } = await searchParams;
  const { categories, services } = await loadServices(null);

  return (
    <>
      <PageHeader title="Services" subtitle='The list behind "Add service" on quotations and estimates: categories, services, a fixed price or default hours, and the parts to ask for.' actions={<LinkButton href="/settings" tone="secondary">Back to settings</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card className="flex flex-col gap-2 max-w-xl">
        <SectionLabel>New category</SectionLabel>
        <form action={addCategory} className="flex gap-2">
          <Input name="name" placeholder="For example: Exhaust" required aria-label="Category name" />
          <Button type="submit" size="md">Add category</Button>
        </form>
      </Card>
      {categories.length === 0 ? <Empty title="No categories yet" /> : null}
      {categories.map((c, ci) => {
        const items = services.filter((s) => s.category_id === c.id);
        return (
          <Card key={c.id} id={`cat-${c.id}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <form action={renameCategory.bind(null, c.id)} className="flex items-center gap-2">
                <Input name="name" defaultValue={c.name} className="font-bold w-64" aria-label="Category name" />
                <Button type="submit" tone="secondary" size="md">Rename</Button>
              </form>
              <Badge tone="neutral">{items.length} service{items.length === 1 ? "" : "s"}</Badge>
              <span className="ml-auto flex gap-1">
                <form action={moveCategory.bind(null, c.id, "up")}>
                  <Button type="submit" tone="secondary" size="md" disabled={ci === 0} aria-label="Move the category up">↑</Button>
                </form>
                <form action={moveCategory.bind(null, c.id, "down")}>
                  <Button type="submit" tone="secondary" size="md" disabled={ci === categories.length - 1} aria-label="Move the category down">↓</Button>
                </form>
                <form action={removeCategory.bind(null, c.id)}>
                  <Button type="submit" tone="danger" size="md">Remove</Button>
                </form>
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-line">
              {items.map((s, si) => (
                <li key={s.id} className="py-1">
                  <details>
                    <summary className="cursor-pointer min-h-11 flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-xs text-muted">{DEPT_LABELS[s.department] ?? s.department}</span>
                      <span className="text-xs font-semibold">{s.price_aed !== null ? aed(s.price_aed) : s.default_hours !== null ? hoursText(s.default_hours) : "hours typed by the advisor"}</span>
                      {s.parts_requests.length ? <span className="text-xs text-muted">· Parts: {s.parts_requests.join(", ")}</span> : null}
                    </summary>
                    <div className="mt-3 mb-2 flex flex-col gap-3 rounded-control border border-line p-3">
                      <form action={saveService.bind(null, s.id)} className="flex flex-col gap-3">
                        <ServiceFields s={s} categories={categories} />
                        <div>
                          <Button type="submit" size="md">Save</Button>
                        </div>
                      </form>
                      <div className="flex flex-wrap gap-1">
                        <form action={moveService.bind(null, s.id, "up")}>
                          <Button type="submit" tone="secondary" size="md" disabled={si === 0}>↑ Move up</Button>
                        </form>
                        <form action={moveService.bind(null, s.id, "down")}>
                          <Button type="submit" tone="secondary" size="md" disabled={si === items.length - 1}>↓ Move down</Button>
                        </form>
                        <form action={removeService.bind(null, s.id)}>
                          <Button type="submit" tone="danger" size="md">Remove</Button>
                        </form>
                      </div>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
            <details className="rounded-control border border-dashed border-line-strong p-3">
              <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold">+ Add a service to {c.name}</summary>
              <form action={addService.bind(null, c.id)} className="mt-3 flex flex-col gap-3">
                <ServiceFields s={null} categories={categories} />
                <div>
                  <Button type="submit" size="md">Add service</Button>
                </div>
              </form>
            </details>
          </Card>
        );
      })}
    </>
  );
}
