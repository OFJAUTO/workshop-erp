import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { companyFromSettings } from "@/lib/company";
import { customerPageMetadata } from "@/lib/customer-pages";
import { formatDate } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { TERMS_LABELS, type TermsKey } from "@/lib/warranty";
import { warrantyCardByToken } from "@/lib/warranty-data";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return customerPageMetadata("OFJ Automotive, Your Warranty", "What is covered, until when, and the warranty status", `/warranty/${token}`);
}

/**
 * Section 12: the page the warranty QR opens - premium and calm, minimal personal data and no prices. The car, the
 * VIN, every product with its coverage, roll or batch, cutting method or darkness and its dates, the terms, and the
 * STATUS: Pending activation until the 10-day check, then Active ✓ with the check date and the team leader's photos.
 */
export default async function WarrantyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const settings = await getSettings();
  const company = companyFromSettings(settings);
  const card = await warrantyCardByToken(token, settings);
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-[#E9E9EC] px-4 py-8">
      <main className="mx-auto flex max-w-2xl flex-col gap-4">{children}</main>
    </div>
  );
  if (!card) return shell(<div className="rounded-xl bg-white p-6 text-sm">This warranty link is not valid. Please ask OFJ Automotive for a new one.</div>);
  const phoneDigits = company.phone.replace(/[^\d]/g, "");
  const bookText = `Hello OFJ, I would like to book the 10-day after-care check for my ${card.car}${card.plate ? ` (${card.plate})` : ""}. Warranty ${card.certificateNo}.`;
  const s = card.status;
  const statusTone = s.kind === "active" ? "border-green bg-green-soft" : s.kind === "not_activated" ? "border-red-bar bg-red-soft" : s.kind === "pending" ? "border-amber-bar bg-amber-soft" : "border-[#D4D4D8] bg-white";
  const termKeys = Array.from(new Set<TermsKey>([...card.rows.map((r) => r.product), ...(card.mechanical ? (["mechanical"] as TermsKey[]) : [])]));
  const today = new Date().toISOString();
  return shell(
    <>
      <section className="flex flex-col items-center gap-2 rounded-xl border-2 border-[#111113] bg-white p-1" data-warranty-page>
        <div className="flex w-full flex-col items-center gap-2 rounded-lg border border-[#A1A1AA] px-5 py-6 text-center">
          <Logo className="h-10 w-auto" />
          <h1 className="mt-2 text-2xl font-extrabold tracking-[0.12em]">YOUR OFJ WARRANTY</h1>
          <p className="text-sm text-[#5F6368]">Certificate no. {card.certificateNo}</p>
          <p className="text-base font-bold">{card.car}{card.colour ? ` · ${card.colour}` : ""}</p>
          <p className="text-sm text-[#5F6368]">{[card.plate, card.vin ? `VIN ${card.vin}` : null].filter(Boolean).join(" · ")}</p>
        </div>
      </section>

      <section className={`flex flex-col gap-2 rounded-xl border-2 px-5 py-4 ${statusTone}`} data-warranty-status={s.kind}>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F6368]">Status</span>
        <span className="text-lg font-extrabold leading-snug">{s.title}</span>
        {s.kind === "active" && s.checkDate ? <span className="text-sm">10-day after-care check completed on {formatDate(s.checkDate)}.</span> : null}
        {s.kind === "active" && s.manual ? <span className="text-sm">Activated by OFJ Automotive on {formatDate(s.manual.at)}{s.manual.note ? `: ${s.manual.note}` : "."}</span> : null}
        {s.kind === "active" && !s.checkDate && !s.manual && card.handoverDay ? <span className="text-sm">From the handover on {formatDate(card.handoverDay)}.</span> : null}
        {s.kind === "pending" ? <span className="text-sm">The complimentary 10-day after-care check activates your warranty{s.due ? `; it is due around ${formatDate(s.due)}` : ""}.</span> : null}
        {s.kind === "not_activated" && s.reminders.length ? <span className="text-sm" data-warranty-reminders>Reminders sent on {s.reminders.map((d) => formatDate(d)).join(", ")}.</span> : null}
        {s.kind === "before_handover" ? <span className="text-sm">{s.detail}</span> : null}
        {s.kind === "pending" || s.kind === "not_activated" ? (
          <a href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(bookText)}`} target="_blank" rel="noreferrer" className="mt-1 flex min-h-12 items-center justify-center rounded-lg bg-[#111113] px-4 text-base font-extrabold text-white" data-book-check>Book your check</a>
        ) : null}
        {card.checkPhotos.length ? (
          <div className="mt-1 grid grid-cols-3 gap-2" data-warranty-check-photos>
            {card.checkPhotos.filter((p) => p.url).map((p) => (
              <a key={p.id} href={p.url!} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url!} alt="10-day check photo" className="aspect-square w-full rounded-lg object-cover bg-[#F4F4F5]" />
              </a>
            ))}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-xl bg-white px-5 py-4" data-warranty-products>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F6368]">What is covered</span>
        {card.rows.map((r) => (
          <div key={`${r.product}:${r.itemKey}`} className="flex flex-col gap-1 border-t border-[#E4E4E7] pt-3 first:border-t-0 first:pt-0" data-warranty-product={r.product}>
            <span className="text-base font-extrabold">{r.name}</span>
            <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-[#5F6368]">Coverage</dt><dd>{r.coverage}</dd>
              {r.cut ? <><dt className="text-[#5F6368]">Cutting method</dt><dd>{r.cut}</dd></> : null}
              {r.darkness ? <><dt className="text-[#5F6368]">Darkness</dt><dd>{r.darkness}</dd></> : null}
              <dt className="text-[#5F6368]">Roll / batch</dt><dd>{r.rollBatch ?? "—"}</dd>
              <dt className="text-[#5F6368]">Warranty</dt><dd>{r.period}</dd>
              <dt className="text-[#5F6368]">Valid</dt><dd className="font-semibold">{r.start && r.validUntil ? `${formatDate(r.start)} to ${formatDate(r.validUntil)}` : "From the handover day"}</dd>
            </dl>
          </div>
        ))}
        {card.mechanical ? (
          <div className="flex flex-col gap-1 border-t border-[#E4E4E7] pt-3" data-warranty-product="mechanical">
            <span className="text-base font-extrabold">Workmanship</span>
            <span className="text-sm">{card.mechanical.period}{card.mechanical.start && card.mechanical.validUntil ? `, ${formatDate(card.mechanical.start)} to ${formatDate(card.mechanical.validUntil)}` : ", from the handover day"}</span>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-xl bg-white px-5 py-4" data-warranty-terms>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F6368]">Terms</span>
        {termKeys.map((k) => (
          <div key={k} className="flex flex-col gap-1">
            <span className="text-sm font-bold">{TERMS_LABELS[k]}</span>
            <p className="text-sm leading-relaxed">{card.terms[k].short}</p>
            <details className="text-sm">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold underline underline-offset-4">Full terms</summary>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#3F3F46]">{card.terms[k].full}</p>
            </details>
          </div>
        ))}
      </section>

      <footer className="flex flex-col items-center gap-2 pb-6 text-center text-xs text-[#5F6368]">
        <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`} className="flex min-h-12 w-full items-center justify-center rounded-lg border-2 border-[#111113] bg-white px-4 text-sm font-extrabold text-[#111113]">Call OFJ · {company.phone}</a>
        <span>Verified by {company.legalName} on {formatDate(today)}.</span>
      </footer>
    </>,
  );
}
