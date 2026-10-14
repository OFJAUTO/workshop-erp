import type { Metadata } from "next";
import { ContactButtons, CustomerFront, customerBoxes } from "@/components/CustomerFront";
import { loadHandover } from "@/lib/bodyshop-public";
import { companyFromSettings } from "@/lib/company";
import { customerPageMetadata } from "@/lib/customer-pages";
import { formatDate } from "@/lib/format";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return customerPageMetadata("OFJ Automotive · Your handover", "Before and after, your warranty certificate, care instructions and the final check date.", `/handover/${token}`);
}

/**
 * The customer's handover page: before and after side by side, the warranty certificate, the care instructions and
 * the final check date. Calm and premium: no staff names, no costs, no internal notes.
 */
export default async function HandoverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const settings = await getSettings();
  const data = await loadHandover(token, settings);
  const company = companyFromSettings(settings);
  if (!data) {
    return (
      <div className="min-h-screen bg-[#E9E9EC] flex items-center justify-center p-6">
        <div className="rounded-lg bg-white p-6 text-sm">This link is not valid. Please ask the workshop for a new one.</div>
      </div>
    );
  }
  const brand = String(settings.ppf_brand_name || "OFJ PPF");
  const years = Number(settings.ppf_warranty_years) || 10;
  const meta = [
    { label: "Job", value: data.job.job_number },
    { label: "Handed over", value: formatDate(data.job.gated_out_at ?? data.job.promised_at) },
    ...(data.finalCheck ? [{ label: "Final check", value: formatDate(data.finalCheck) }] : []),
  ];
  const boxes = customerBoxes(data.customer ? { full_name: data.customer.full_name, company_name: data.customer.company_name, phone: data.customer.phone } : null, { kind: "car", variant: null, vin: data.job.vehicle?.vin ?? null, plate: data.plate, title: data.carTitle });
  return (
    <CustomerFront
      company={company}
      header="plain"
      title="Your handover"
      meta={meta}
      boxes={boxes}
      view={data.warranty ? { href: `/api/pdf/warranty/${token}`, label: "View warranty certificate (PDF)" } : null}
      contact={<ContactButtons name={data.advisor?.name ?? null} phone={data.advisor?.phone ?? null} label="Questions?" />}
    >
      <div className="flex flex-col gap-4" data-handover>
        {data.beforeUrl || data.afterUrl ? (
          <div className="grid grid-cols-2 gap-3">
            <figure className="flex flex-col gap-1">
              {data.beforeUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.beforeUrl} alt="Before" className="aspect-[4/3] w-full rounded-lg object-cover bg-[#F4F4F5]" />
              ) : <div className="aspect-[4/3] w-full rounded-lg bg-[#F4F4F5]" />}
              <figcaption className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">Before</figcaption>
            </figure>
            <figure className="flex flex-col gap-1">
              {data.afterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.afterUrl} alt="After" className="aspect-[4/3] w-full rounded-lg object-cover bg-[#F4F4F5]" />
              ) : <div className="aspect-[4/3] w-full rounded-lg bg-[#F4F4F5]" />}
              <figcaption className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">After</figcaption>
            </figure>
          </div>
        ) : null}
        {data.warranty ? (
          <div className="rounded-lg border border-[#D4D4D8] px-4 py-4 flex flex-col gap-1" data-warranty>
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">{brand} · {years}-year warranty</span>
            <span className="text-sm">{data.filmText}. Installed {formatDate(data.warranty.installDate)}, valid until {formatDate(data.warranty.validUntil)}. Certificate {data.warranty.certificateNo}.</span>
          </div>
        ) : null}
        <div className="rounded-lg bg-[#F4F4F5] px-4 py-4 flex flex-col gap-1" data-care>
          <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">Care instructions</span>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{String(settings.ppf_care_text || "")}</p>
        </div>
        {data.finalCheck ? (
          <div className="rounded-lg border border-[#D4D4D8] px-4 py-4 flex flex-col gap-1" data-final-check>
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">Final check</span>
            <span className="text-sm">We will see the car again on {formatDate(data.finalCheck)} for a short check of the film. We will send a reminder the day before.</span>
          </div>
        ) : null}
      </div>
    </CustomerFront>
  );
}
