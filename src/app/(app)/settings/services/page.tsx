import { ServicePriceField } from "./ServicePriceField";
import { Badge, Button, Card, Empty, Field, Input, LinkButton, Notice, PageHeader, SectionLabel, Select, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { loadServices } from "@/lib/quote-data";
import { isFixedService,aed, hoursText, type Service, type ServiceCategory } from "@/lib/quotes";
import { addCategory, addService, adoptCustomJob, dismissCustomJob, moveCategory, moveService, removeCategory, removeService, renameCategory, saveService } from "./actions";
import { getSettings } from "@/lib/settings";
import { TYRE_POSITIONS, checklistItems, type ChecklistSection } from "@/lib/inspection";
import { BODYSHOP_KINDS, BODYSHOP_KIND_LABELS } from "@/lib/bodyshop-kinds";

export const dynamic = "force-dynamic";

const DEPT_LABELS: Record<string, string> = { mechanical: "Mechanical", bodyshop: "Bodyshop", both: "Both" };

type SuggestOption = { value: string; label: string };

function ServiceFields({ s, categories, suggestOptions, defaultMode = "hours" }: { s: Service | null; categories: ServiceCategory[]; suggestOptions: SuggestOption[]; defaultMode?: "hours" | "fixed" }) {
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
      <Field label="Bodyshop package" hint="Builds the stages on a bodyshop car; the advisor types the price every time (no fixed price, no car-size pricing).">
        <Select name="bodyshop_kind" defaultValue={s?.bodyshop_kind ?? ""}>
          <option value="">Not a bodyshop package</option>
          {BODYSHOP_KINDS.map((k) => <option key={k} value={k}>{BODYSHOP_KIND_LABELS[k]}</option>)}
        </Select>
      </Field>
      <ServicePriceField priceAed={s?.price_aed ?? null} defaultHours={s?.default_hours ?? null} pricePer={s?.price_per ?? "job"} usualQuantity={s?.usual_quantity ?? 1} timeAllowance={s?.time_allowance_hours ?? null} defaultMode={defaultMode} />
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
      <label className="flex items-start gap-3 cursor-pointer text-sm"><input type="checkbox" name="position_ask" defaultChecked={!!s?.position_ask} className="mt-1 h-5 w-5 accent-ink" /><span><span className="font-semibold">Asks the position</span><span className="block text-xs text-muted">When added to a quotation it asks &quot;Front, rear or both?&quot;; one row carries all the positions.</span></span></label>
      <label className="flex items-start gap-3 cursor-pointer text-sm"><input type="checkbox" name="outside_work" defaultChecked={!!s?.outside_work} className="mt-1 h-5 w-5 accent-ink" /><span><span className="font-semibold">Outside work</span> <span className="text-muted">(another company does the job, like lathe work): the quotation shows an &quot;our cost&quot; box on the line and it never takes the labour discount. Our own bodyshop services are never outside work.</span></span></label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Installer hours (internal, bodyshop costing: how long our installers usually take; copied onto each quotation line, editable there)<Input name="installer_hours" defaultValue={s?.installer_hours !== null && s?.installer_hours !== undefined ? String(s.installer_hours) : ""} inputMode="decimal" placeholder="for example 96" className="w-32" /></label>
      <Field label="Suggested for" optional hint="The report findings this job answers. It comes first under Suggested on the quotation. Hold Ctrl (or Cmd) to pick several.">
        <Select name="suggest_for" multiple defaultValue={s?.suggest_for ?? []} className="min-h-32 py-2">
          {suggestOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** The owner's services list: categories and services behind "Add service" on quotations and estimates. */
export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; list?: string }> }) {
  await requirePermission("manageServices");
  const { message, error, list } = await searchParams;
  // Two lists with the same categories: Labour jobs (priced by hours) and Services (a fixed price per unit).
  const showBodyshop = list === "bodyshop";
  const showLabour = !showBodyshop && list !== "services";
  const kindWord = showLabour ? "labour job" : "service";
  const [{ categories, services }, settings] = await Promise.all([loadServices(null), getSettings()]);
  const suggestOptions: SuggestOption[] = [
    ...checklistItems((settings.inspection_checklist ?? []) as ChecklistSection[]).map((i) => ({ value: i.key, label: `${i.sectionTitle} · ${i.label}` })),
    ...TYRE_POSITIONS.map((p) => ({ value: `tyre:${p.key}`, label: `Tyre replace · ${p.label}` })),
    { value: "measure:battery_health", label: "Battery test · Replace" },
  ];
  const customJobs = Object.entries((settings.custom_jobs_used ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader title="Labour jobs and services" subtitle='Two lists behind "+ Add line" on quotations and estimates: labour jobs priced by hours and services at a fixed price per unit, in the same categories.' actions={<LinkButton href="/settings" tone="secondary">Back to settings</LinkButton>} />
      <div className="grid grid-cols-2 gap-2 max-w-xl">
        <LinkButton href="/settings/services?list=labour" tone={showLabour ? "primary" : "secondary"} size="lg">Labour jobs (by hours)</LinkButton>
        <LinkButton href="/settings/services?list=services" tone={!showLabour && !showBodyshop ? "primary" : "secondary"} size="lg">Services (fixed price)</LinkButton>
        <LinkButton href="/settings/services?list=bodyshop" tone={showBodyshop ? "primary" : "secondary"} size="lg">Bodyshop packages</LinkButton>
      </div>
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {customJobs.length && showLabour ? (
        <Card className="flex flex-col gap-3 border-ink">
          <SectionLabel right={`${customJobs.length}`}>Suggestions: custom jobs typed on quotations</SectionLabel>
          <ul className="divide-y divide-line">
            {customJobs.map(([name, n]) => (
              <li key={name} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{name}</span>
                <span className="text-xs text-muted">typed {n} time{n === 1 ? "" : "s"}</span>
                <form action={adoptCustomJob.bind(null, name)} className="ml-auto flex items-center gap-2">
                  <Select name="category_id" className="w-56">
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                  <Button type="submit" size="md">Add to list</Button>
                </form>
                <form action={dismissCustomJob.bind(null, name)}><Button type="submit" tone="ghost" size="md">Dismiss</Button></form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card className="flex flex-col gap-2 max-w-xl">
        <SectionLabel>New category</SectionLabel>
        <form action={addCategory} className="flex gap-2">
          <Input name="name" placeholder="For example: Exhaust" required aria-label="Category name" />
          <Button type="submit" size="md">Add category</Button>
        </form>
      </Card>
      {categories.length === 0 ? <Empty title="No categories yet" /> : null}
      {categories.map((c, ci) => {
        const items = services.filter((s) => s.category_id === c.id && (showBodyshop ? !!s.bodyshop_kind : showLabour ? !isFixedService(s) && !s.bodyshop_kind : isFixedService(s) && !s.bodyshop_kind));
        return (
          <Card key={c.id} id={`cat-${c.id}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <form action={renameCategory.bind(null, c.id)} className="flex items-center gap-2">
                <Input name="name" defaultValue={c.name} className="font-bold w-64" aria-label="Category name" />
                <Button type="submit" tone="secondary" size="md">Rename</Button>
              </form>
              <Badge tone="neutral">{items.length} {kindWord}{items.length === 1 ? "" : "s"}</Badge>
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
                        <ServiceFields s={s} categories={categories} suggestOptions={suggestOptions} />
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
              <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold">+ Add a {kindWord} to {c.name}</summary>
              <form action={addService.bind(null, c.id)} className="mt-3 flex flex-col gap-3">
                <ServiceFields s={null} categories={categories} suggestOptions={suggestOptions} defaultMode={showLabour ? "hours" : "fixed"} />
                <div>
                  <Button type="submit" size="md">Add {kindWord}</Button>
                </div>
              </form>
            </details>
          </Card>
        );
      })}
    </>
  );
}
