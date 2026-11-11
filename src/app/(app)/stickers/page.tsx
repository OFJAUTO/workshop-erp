import Link from "next/link";
import { Button, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { openCarsForStickers, searchStickerParts, stickerHistory, todaysArrivals } from "@/lib/sticker-tab";
import { warrantyTypesOf, writeExtraTypes } from "@/lib/sticker-types";
import { stickerSettings } from "@/lib/stickers";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { StickerSettingsBody } from "../settings/stickers/StickerSettingsBody";
import { saveWarrantyTypes } from "./actions";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "parts", label: "Part stickers" },
  { key: "warranty", label: "Warranty stickers" },
  { key: "history", label: "History" },
  { key: "printer", label: "Printer setup" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/**
 * THE STICKERS TAB (11 November 2026, Section 12): one place to print every sticker. Part stickers (a search, or
 * today's arrivals; tick and print one PDF - the sticker carries only the logo, the part's name and the QR), warranty
 * stickers (battery first, the oil service sticker, and the types the owner adds), the history with reprint, and the
 * printer setup moved here from Settings. The print buttons elsewhere stay and print through the same pages.
 */
export default async function StickersPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; car?: string; message?: string; error?: string }> }) {
  const staff = await requirePermission("printStickers");
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "parts";
  const isOwner = can(staff.role_id as RoleId, "manageSettings");
  const q = (sp.q ?? "").trim();
  const settings = await getSettings();
  const ss = stickerSettings(settings);
  const tabHref = (t: Tab) => `/stickers${t === "parts" ? "" : `?tab=${t}`}`;
  return (
    <>
      <PageHeader title="Stickers" subtitle="Part stickers, warranty stickers, what was printed, and the printer setup." />
      {sp.message && tab !== "printer" ? <Notice tone="success">{sp.message}</Notice> : null}
      {sp.error && tab !== "printer" ? <Notice tone="error">{sp.error}</Notice> : null}
      <nav className="flex flex-wrap gap-1 rounded-control border border-line-strong bg-white p-1 self-start" data-stickers-tabs>
        {TABS.map((t) => (
          <Link key={t.key} href={tabHref(t.key)} aria-current={tab === t.key ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-control px-4 text-sm font-bold ${tab === t.key ? "bg-ink text-on-dark" : "text-ink"}`} data-stickers-tab={t.key}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "parts" ? <PartStickers q={q} printer={ss.printerPart} /> : null}
      {tab === "warranty" ? <WarrantyStickers q={(sp.car ?? "").trim()} isOwner={isOwner} stored={settings.sticker_warranty_types} /> : null}
      {tab === "history" ? <History /> : null}
      {tab === "printer" ? (
        isOwner ? (
          <div id="printer" className="flex flex-col gap-4">
            <StickerSettingsBody message={sp.message} error={sp.error} />
          </div>
        ) : (
          <Card className="flex flex-col gap-3" id="printer" data-printer-tips>
            <SectionLabel>Printer tips</SectionLabel>
            <p className="text-sm">Part stickers print on <b>{ss.printerPart}</b> ({ss.partW} × {ss.partH} mm). Battery, service and warranty stickers print on <b>{ss.printerLarge}</b>.</p>
            <p className="text-sm text-muted">Print a test label first: it has a thin border, so you can see that the label sits square on the roll. The sizes and the logo are changed by the owner.</p>
            <LinkButton href="/api/pdf/part-labels?test=1" tone="secondary" target="_blank" data-test-label>Print a test label</LinkButton>
          </Card>
        )
      ) : null}
    </>
  );
}

async function PartStickers({ q, printer }: { q: string; printer: string }) {
  const parts = q ? await searchStickerParts(q) : await todaysArrivals();
  return (
    <Card className="flex flex-col gap-4" data-sticker-parts={q ? "search" : "today"}>
      <form method="get" action="/stickers" className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Job number, plate, VIN or part name" className="min-h-12 min-w-0 flex-1 rounded-control border border-line-strong bg-white px-3 text-base" data-sticker-search data-spell="" autoComplete="off" />
        <Button type="submit">Find</Button>
        {q ? <LinkButton href="/stickers" tone="secondary" data-sticker-today>Today&apos;s arrivals</LinkButton> : null}
      </form>
      <SectionLabel right={`${parts.length}`}>{q ? `Parts for “${q}”` : "Today's arrivals"}</SectionLabel>
      {parts.length === 0 ? (
        <Empty title={q ? "No received part for this search" : "Nothing has arrived today yet"}>Stickers are made for parts once they are received.</Empty>
      ) : (
        <form method="get" action="/api/pdf/part-labels" target="_blank" className="flex flex-col gap-3" data-sticker-print-form>
          <p className="text-xs text-muted">Tick the parts, then print: one PDF, one sticker per piece, on {printer}. The sticker shows the OFJ logo, the part&apos;s name and the QR code only.</p>
          <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
            {parts.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2" data-sticker-part={p.id}>
                  <input type="checkbox" name="parts" value={p.id} defaultChecked={!q} className="h-5 w-5 shrink-0 accent-ink" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold uppercase">{p.name}</span>
                    <span className="block text-xs text-muted">{[p.jobNumber, p.plate, p.car].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold">× {p.qty}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" data-sticker-print>Print the ticked stickers</Button>
            {!q ? <LinkButton href="/api/pdf/part-labels?today=1" tone="secondary" target="_blank" data-sticker-print-today>Print all of today&apos;s</LinkButton> : null}
          </div>
        </form>
      )}
    </Card>
  );
}

async function WarrantyStickers({ q, isOwner, stored }: { q: string; isOwner: boolean; stored: unknown }) {
  const types = warrantyTypesOf(stored);
  const extra = types.filter((t) => !t.builtIn);
  const admin = createAdminClient();
  const [{ data: bw }, cars] = await Promise.all([
    admin.from("battery_warranties").select("id, job_id, handover_id, brand, model, installed_on, warranty_until, job:jobs(job_number)").eq("is_active", true).order("installed_on", { ascending: false }).limit(30),
    openCarsForStickers(q),
  ]);
  const batteries = (bw ?? []) as unknown as { id: string; job_id: string; handover_id: string | null; brand: string | null; model: string | null; installed_on: string; warranty_until: string; job: { job_number: string } | null }[];
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3" data-warranty-battery>
        <SectionLabel right={`${batteries.length}`}>Battery warranty stickers</SectionLabel>
        <p className="text-xs text-muted">A battery sticker is made when the battery is handed to the technician. Print it again here.</p>
        {batteries.length === 0 ? <p className="text-sm text-muted">No battery fitted yet.</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {batteries.map((b) => (
              <li key={b.id} className="flex min-h-12 flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1 text-sm"><b>{b.job?.job_number ?? ""}</b> · {[b.brand, b.model].filter(Boolean).join(" ") || "Battery"} · fitted {formatDate(b.installed_on)} · until {formatDate(b.warranty_until)}</span>
                {b.handover_id ? <LinkButton href={`/print/stickers/${b.handover_id}?reprint=1&back=${encodeURIComponent("/stickers?tab=warranty")}`} tone="secondary" target="_blank" data-battery-reprint={b.id}>Print again</LinkButton> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="flex flex-col gap-3" data-warranty-cars>
        <SectionLabel>Oil service and other warranty stickers</SectionLabel>
        <form method="get" action="/stickers" className="flex flex-wrap gap-2">
          <input type="hidden" name="tab" value="warranty" />
          <input name="car" defaultValue={q} placeholder="Job number or plate (empty = cars in the workshop)" className="min-h-12 min-w-0 flex-1 rounded-control border border-line-strong bg-white px-3 text-base" data-warranty-car-search data-spell="" autoComplete="off" />
          <Button type="submit">Find</Button>
        </form>
        {cars.length === 0 ? <p className="text-sm text-muted">No car found.</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {cars.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 py-3" data-warranty-car={c.id}>
                <span className="text-sm"><b>{c.jobNumber}</b> · {[c.plate, c.car].filter(Boolean).join(" · ")}</span>
                <div className="flex flex-wrap gap-2">
                  <LinkButton href={`/print/service-sticker/${c.id}?back=${encodeURIComponent("/stickers?tab=warranty")}`} tone="secondary" target="_blank" data-service-print={c.id}>Oil service sticker</LinkButton>
                  {extra.map((t) => t.batch ? (
                    <form key={t.key} method="get" action={`/print/warranty-sticker/${c.id}`} target="_blank" className="flex flex-wrap items-center gap-1.5">
                      <input type="hidden" name="type" value={t.key} />
                      <input name="batch" required placeholder="Batch" className="min-h-11 w-28 rounded-control border border-line-strong bg-white px-2 text-sm uppercase" data-warranty-batch={t.key} autoComplete="off" />
                      <Button type="submit" tone="secondary" data-warranty-print={t.key}>{t.label}</Button>
                    </form>
                  ) : (
                    <LinkButton key={t.key} href={`/print/warranty-sticker/${c.id}?type=${t.key}`} tone="secondary" target="_blank" data-warranty-print={t.key}>{t.label}</LinkButton>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {isOwner ? (
        <Card className="flex flex-col gap-3" data-warranty-types>
          <SectionLabel>Warranty sticker types (owner)</SectionLabel>
          <p className="text-xs text-muted">Battery and oil service are built in. Add more, one per line: <b>Name = months</b>. Add <b>= batch</b> for a sticker that must carry a batch number (PPF and tint only).</p>
          <form action={saveWarrantyTypes} className="flex flex-col gap-3">
            <Textarea name="types" rows={4} defaultValue={writeExtraTypes(types)} spell={false} data-warranty-types-text />
            <Button type="submit" className="self-start" data-warranty-types-save>Save the types</Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}

async function History() {
  const rows = await stickerHistory(80);
  const KIND: Record<string, string> = { part: "Part", battery: "Battery", service: "Oil service", warranty: "Warranty", item: "Item tag" };
  return (
    <Card className="flex flex-col gap-3" data-sticker-history>
      <SectionLabel right={`${rows.length}`}>Stickers made, newest first</SectionLabel>
      {rows.length === 0 ? <Empty title="No sticker printed yet" /> : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.code} className="flex min-h-12 flex-wrap items-center gap-3 py-2" data-sticker-history-row={r.kind}>
              <span className="w-24 shrink-0 text-xs font-bold uppercase text-muted">{KIND[r.kind] ?? r.kind}</span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-semibold uppercase">{r.what}</span>
                <span className="block text-xs text-muted">{[r.jobNumber, r.plate, formatDateTime(r.at), r.by].filter(Boolean).join(" · ")}</span>
              </span>
              {r.reprint ? <LinkButton href={r.reprint} tone="secondary" target="_blank" data-sticker-reprint={r.code}>Reprint</LinkButton> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
