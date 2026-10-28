import { CarOutline } from "./CarOutline";
import { CustomerVideoList } from "./CustomerVideoList";
import { ViewerThumb } from "./PhotoViewer";
import type { FrontBox } from "./CustomerFront";
import { formatDate } from "@/lib/format";
import type { ReportData, ReportHead, ReportPlace } from "@/lib/report-data";
import { TONE_COLOURS, type Chip, type Finding, type Section } from "@/lib/report-layout";

/**
 * THE inspection report on a screen (29 October 2026, section 8): the customer's link and the staff preview draw
 * this one component from the one layout (`buildReportLayout`), the PDF draws the same layout. Needs attention at the
 * top, the workshop's note, then one block per part with its numbers, findings, photos and videos together, and
 * Checked and passed last. Every photo and video opens THE viewer (swipe through all of them in page order).
 */

/** VEHICLE / CUSTOMER / INSPECTED: the three boxes at the top (the customer's page shows them in its own header). */
export function reportBoxes(head: ReportHead): FrontBox[] {
  return [
    head.loose
      ? { title: "Items", strong: head.car, rows: [] }
      : { title: "Vehicle", strong: head.car, rows: [["Plate", head.plate], ["Mileage", head.mileage], ["VIN", head.vin]] },
    { title: "Customer", strong: head.customer, rows: [["", head.customerSub], ["", head.phone]] },
    { title: "Inspected", strong: head.inspectedAt ? formatDate(head.inspectedAt) : "—", rows: [["Job card", head.jobNumber], ["Approved", head.approvedAt ? formatDate(head.approvedAt) : null]] },
  ];
}

export function ReportChip({ chip, big = false }: { chip: Chip; big?: boolean }) {
  const c = TONE_COLOURS[chip.tone];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full font-extrabold uppercase tracking-[0.06em] whitespace-nowrap ${big ? "px-3 py-1 text-[11px]" : "px-2 py-0.5 text-[10px]"}`} style={{ background: c.bg, color: c.fg }} data-chip={chip.tone}>
      {chip.text}
    </span>
  );
}

const SMALL_TITLE = "text-[10px] font-extrabold tracking-[0.12em] uppercase text-[#5F6368]";

function Media({ keys, data, section, refreshUrl, signedAt }: { keys: string[]; data: ReportData; section: string; refreshUrl: string; signedAt: number }) {
  const places = keys.map((k) => data.media[k]).filter((p): p is ReportPlace => !!p && p.photos.length + p.videos.length > 0);
  if (!places.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {places.some((p) => p.photos.length) ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-report-photos>
          {places.flatMap((p) =>
            p.photos.map((ph) => (
              <ViewerThumb key={ph.id} src={ph.url} thumb={ph.thumb} label={p.label} detail={section} viewerKey={ph.id} className="block aspect-square w-full overflow-hidden rounded-lg bg-[#F4F4F5]" data-report-photo={ph.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ph.thumb ?? ph.url} alt={p.label} loading="lazy" className="h-full w-full object-cover" />
              </ViewerThumb>
            )),
          )}
        </div>
      ) : null}
      {places.some((p) => p.videos.length) ? <CustomerVideoList videos={places.flatMap((p) => p.videos)} signedAt={signedAt} refreshUrl={refreshUrl} /> : null}
    </div>
  );
}

function FindingRow({ f, children }: { f: Finding; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-[#E4E4E7] pt-2.5 first:border-t-0 first:pt-0" data-finding={f.key}>
      <div className="flex items-start gap-2">
        <ReportChip chip={f.chip} />
        <p className="text-sm leading-snug min-w-0">
          <span className="font-bold">{f.title}</span>
          {f.reason ? <span className="text-[#3F3F46]"> · {f.reason}</span> : null}
          {f.extra.map((w) => (
            <span key={w} className="block text-xs font-semibold">{w}</span>
          ))}
        </p>
      </div>
      {children}
    </div>
  );
}

function SectionBlock({ s, data, refreshUrl, signedAt }: { s: Section; data: ReportData; refreshUrl: string; signedAt: number }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[#E4E4E7] px-3.5 py-3 sm:px-4" data-report-section={s.key}>
      <header className="flex items-center justify-between gap-3 border-b-2 border-[#111113] pb-2">
        <h2 className="text-[15px] font-extrabold tracking-[0.06em]">{s.title}</h2>
        <ReportChip chip={s.chip} big />
      </header>
      {s.lines.length ? (
        <dl className="flex flex-col divide-y divide-[#E4E4E7] text-sm" data-report-lines>
          {s.lines.map((l) => (
            <div key={l.label} className="flex items-center justify-between gap-3 py-1.5">
              <dt className="text-[#5F6368]">{l.label}</dt>
              <dd className="flex items-center gap-2 text-right font-semibold">
                <span>{l.value}</span>
                {l.chip ? <ReportChip chip={l.chip} /> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {s.tables.map((t) => (
        <div key={t.head.join("|")} data-report-table>
          {/* A phone: one block per row with its labelled values; wider: the table. */}
          <div className="flex flex-col divide-y divide-[#E4E4E7] sm:hidden">
            {t.rows.map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-3 py-2">
                <div className="flex flex-col gap-0.5 text-sm min-w-0">
                  <span className="font-bold">{r.label}</span>
                  <span className="text-[#3F3F46]">
                    {r.cells
                      .map((c, k) => (c ? `${t.head[k + 1]} ${c}` : ""))
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {r.chip ? <ReportChip chip={r.chip} /> : null}
              </div>
            ))}
          </div>
          <table className="hidden sm:table w-full text-sm">
            <thead>
              <tr className="text-left">
                {t.head.map((h, k) => (
                  <th key={k} className={`${SMALL_TITLE} pb-1.5 font-extrabold ${k === t.head.length - 1 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.label} className="border-t border-[#E4E4E7]">
                  <td className="py-1.5 pr-3 font-bold whitespace-nowrap">{r.label}</td>
                  {r.cells.map((c, k) => (
                    <td key={k} className="py-1.5 pr-3">{c}</td>
                  ))}
                  <td className="py-1.5 text-right">{r.chip ? <ReportChip chip={r.chip} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {s.body ? (
        <div className="flex items-start gap-4" data-report-body>
          <CarOutline tones={Object.fromEntries(s.body.findings.map((f) => [f.panel, f.red ? "red" : "amber"]))} size={110} />
          <p className="text-xs text-[#5F6368]">Seen from above, front at the top. Amber: minor. Red: moderate or severe.</p>
        </div>
      ) : null}
      {s.findings.length ? (
        <div className="flex flex-col gap-2.5">
          {s.findings.map((f) => (
            <FindingRow key={f.key} f={f}>
              <Media keys={f.mediaKeys} data={data} section={s.title} refreshUrl={refreshUrl} signedAt={signedAt} />
            </FindingRow>
          ))}
        </div>
      ) : null}
      {s.good.map((g) => (
        <div key={g.key} className="flex flex-col gap-1.5" data-report-good={g.key}>
          <p className="text-sm">
            <span className="font-bold text-[#1B6B2F]">✓ </span>
            <span className="font-semibold">{g.title}</span>
            {g.note ? <span className="text-[#3F3F46]"> · {g.note}</span> : null}
          </p>
          <Media keys={g.mediaKeys} data={data} section={s.title} refreshUrl={refreshUrl} signedAt={signedAt} />
        </div>
      ))}
      <Media keys={s.mediaKeys} data={data} section={s.title} refreshUrl={refreshUrl} signedAt={signedAt} />
    </section>
  );
}

export function InspectionReport({ data, refreshUrl, signedAt, withHead = false }: { data: ReportData; /** Fresh video addresses (the customer's link); a staff page without one passes "". */ refreshUrl: string; signedAt: number; /** The staff preview draws the three header boxes itself. */ withHead?: boolean }) {
  const { layout } = data;
  const n = layout.attention.length;
  return (
    <div className="flex flex-col gap-4" data-inspection-report>
      {withHead ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {reportBoxes(data.head).map((b) => (
            <div key={b.title} className="rounded-lg bg-[#F4F4F5] px-4 py-3 flex flex-col gap-[3px] text-xs">
              <span className={SMALL_TITLE}>{b.title}</span>
              <span className="text-sm font-bold uppercase">{b.strong}</span>
              {b.rows.filter(([, v]) => v).map(([k, v]) => (
                <span key={k || String(v)}><span className="text-[#5F6368]">{k}{k ? " " : ""}</span>{v}</span>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <section className={`flex flex-col gap-3 rounded-lg px-3.5 py-3 sm:px-4 ${layout.noIssues ? "bg-[#E3F2E7]" : "border-2 border-[#111113]"}`} data-report-attention={n}>
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {layout.noIssues ? <h2 className="text-[15px] font-extrabold tracking-[0.06em] text-[#1B6B2F]">✓ NO ISSUES FOUND</h2> : <h2 className="text-[15px] font-extrabold tracking-[0.06em]">NEEDS ATTENTION · {n}</h2>}
          {layout.passedCount ? <a href="#checked-and-passed" className="text-xs font-semibold text-[#1B6B2F] underline-offset-2 hover:underline">✓ {layout.passedCount} items checked and passed (below)</a> : null}
        </header>
        {layout.dangers.length ? (
          <div className="rounded-md bg-[#B3261E] px-3 py-2 text-sm text-white" data-report-danger>
            <p className="font-extrabold tracking-[0.04em]">DANGEROUS TO DRIVE</p>
            {data.dangerText ? <p className="text-[13px]">{data.dangerText}</p> : null}
          </div>
        ) : null}
        {n ? (
          <ul className="flex flex-col divide-y divide-[#E4E4E7]">
            {layout.attention.map((f) => (
              <li key={f.key} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0" data-attention-line={f.chip.text}>
                <ReportChip chip={f.chip} />
                <p className="flex-1 min-w-0 text-sm leading-snug">
                  <span className="font-bold">{f.title}</span>
                  {f.reason ? <span className="text-[#3F3F46]"> · {f.reason}</span> : null}
                </p>
                <span className="shrink-0 pt-0.5 text-[10px] font-bold tracking-[0.08em] text-[#5F6368]">{f.section}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {layout.note ? (
        <section className="flex flex-col gap-1 rounded-lg bg-[#F4F4F5] px-4 py-3" data-report-note>
          <span className={SMALL_TITLE}>Note from the workshop</span>
          <p className="text-sm whitespace-pre-wrap">{layout.note}</p>
        </section>
      ) : null}

      {layout.sections.map((s) => (
        <SectionBlock key={s.key} s={s} data={data} refreshUrl={refreshUrl} signedAt={signedAt} />
      ))}

      {data.extraVideos.length ? (
        <section className="flex flex-col gap-3 rounded-lg border border-[#E4E4E7] px-3.5 py-3 sm:px-4" data-report-section="videos">
          <header className="border-b-2 border-[#111113] pb-2"><h2 className="text-[15px] font-extrabold tracking-[0.06em]">VIDEOS</h2></header>
          <CustomerVideoList videos={data.extraVideos} signedAt={signedAt} refreshUrl={refreshUrl} />
        </section>
      ) : null}

      {layout.passed.length ? (
        <section id="checked-and-passed" className="flex flex-col gap-3 rounded-lg border border-[#E4E4E7] px-3.5 py-3 sm:px-4 scroll-mt-4" data-report-passed={layout.passedCount}>
          <header className="flex items-center justify-between gap-3 border-b-2 border-[#111113] pb-2">
            <h2 className="text-[15px] font-extrabold tracking-[0.06em]">CHECKED AND PASSED · {layout.passedCount}</h2>
          </header>
          <div className="columns-1 sm:columns-3 gap-6">
            {layout.passed.map((g) => (
              <div key={g.title} className="mb-3 break-inside-avoid">
                <p className={`${SMALL_TITLE} mb-1`}>{g.title}</p>
                <ul className="flex flex-col gap-0.5 text-[13px]">
                  {g.items.map((i) => (
                    <li key={i} className="flex gap-1.5"><span className="font-bold text-[#1B6B2F]">✓</span><span>{i}</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
