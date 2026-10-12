import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Logo } from "./Logo";

export type FrontMeta = { label: string; value: string };
export type FrontBox = { title: string; strong: string; rows: [string, string | null | undefined][] };
type Company = { tradingName: string; legalName: string; address: string[]; phone: string; email: string; website: string; trn: string };

/**
 * The short first page every customer link opens on: the header, the essentials, one big "View" button
 * that opens the full document on its own page, and the single action that page is for. No line items,
 * no small print, no footers. "plain" header: the logo centred on a light grey band (the approval and
 * report links); "full": the company block and the TRN (quotations, proformas, invoices).
 */
export function CustomerFront({ company, header = "full", title, meta, boxes, children, view, action, contact }: {
  company: Company;
  header?: "full" | "plain";
  title: string;
  meta: FrontMeta[];
  boxes: FrontBox[];
  /** The essentials: a total in large print, a note, a line of counts. */
  children?: ReactNode;
  /** The big View button. */
  view?: { href: string; label: string } | null;
  /** The one action this page is for (an approve box, Pay now, ...). */
  action?: ReactNode;
  /** Call and WhatsApp to the advisor. */
  contact?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#E9E9EC] text-[#111113]">
      <main className="mx-auto w-full max-w-[640px] px-0 py-0 sm:px-4 sm:py-6 pb-10">
        <div className="bg-white sm:shadow-sm sm:rounded-lg px-4 sm:px-8 flex flex-col">
          {header === "plain" ? (
            <header className="-mx-4 sm:-mx-8 sm:rounded-t-lg flex items-center justify-center bg-[#F4F4F5] border-b-[3px] border-[#111113] py-5 sm:py-7">
              <Logo className="h-14 sm:h-20 w-auto" alt={company.tradingName} />
            </header>
          ) : (
            <header className="flex items-center justify-between gap-4 border-b-[3px] border-[#111113] pt-6 pb-4 sm:pt-[30px] sm:pb-[18px]">
              <Logo className="h-12 sm:h-16 w-auto" alt={company.tradingName} />
              <div className="flex items-stretch gap-3 text-[10px] sm:text-[10.5px] leading-[1.6]">
                <div className="flex flex-col">
                  <span className="text-[11px] sm:text-xs font-bold tracking-[0.02em]">{company.legalName}</span>
                  {company.address.map((a) => <span key={a} className="text-[#5F6368]">{a}</span>)}
                </div>
                {company.trn ? (
                  <div className="border-l border-[#D4D4D8] pl-3 flex flex-col justify-center gap-0.5">
                    <span className="text-[9px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">Tax registration no.</span>
                    <span className="text-sm font-extrabold tracking-[0.03em] leading-[1.2]">{company.trn}</span>
                  </div>
                ) : null}
              </div>
            </header>
          )}
          <div className="flex flex-col gap-4 pt-5 pb-7">
            <section className="flex flex-wrap items-end justify-between gap-3">
              <h1 className="text-[24px] sm:text-[28px] font-extrabold tracking-[0.02em] leading-none uppercase">{title}</h1>
              <div className="flex flex-wrap justify-end gap-x-5 gap-y-1 text-right">
                {meta.map((m) => (
                  <div key={m.label} className="flex flex-col">
                    <span className="text-[9.5px] font-semibold tracking-[0.08em] uppercase text-[#5F6368]">{m.label}</span>
                    <span className="text-[13px] font-bold">{m.value}</span>
                  </div>
                ))}
              </div>
            </section>
            {boxes.length ? (
              <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {boxes.map((b) => (
                  <div key={b.title} className="rounded-lg bg-[#F4F4F5] px-4 py-3 flex flex-col gap-[3px] text-xs">
                    <span className="text-[9.5px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">{b.title}</span>
                    <span className="text-sm font-bold">{b.strong}</span>
                    {b.rows.filter(([, v]) => v).map(([k, v]) => (
                      <span key={k || String(v)}><span className="text-[#5F6368]">{k}{k ? " " : ""}</span>{v}</span>
                    ))}
                  </div>
                ))}
              </section>
            ) : null}
            {children}
            {view ? (
              <a href={view.href} target="_blank" rel="noreferrer" className="flex min-h-16 items-center justify-center rounded-lg bg-[#111113] px-4 text-lg font-extrabold text-white">
                {view.label}
              </a>
            ) : null}
            {action}
            {contact}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Call and WhatsApp to the advisor, first name only: the one place a staff name appears on a customer page. */
export function ContactButtons({ name, phone, label = null }: { name: string | null; phone: string | null; label?: string | null }) {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  if (!phone && !digits) return null;
  const first = (name ?? "").split(" ")[0];
  return (
    <div className="flex flex-col gap-2">
      {label ? <span className="text-sm font-bold">{label}</span> : null}
      <div className="grid grid-cols-2 gap-3">
        {phone ? <a href={`tel:${phone}`} className="flex min-h-14 items-center justify-center rounded-lg bg-[#111113] px-4 text-base font-extrabold text-white">Call{first ? ` ${first}` : ""}</a> : null}
        {digits ? <a href={`https://wa.me/${digits}`} className="flex min-h-14 items-center justify-center rounded-lg border-2 border-[#111113] bg-white px-4 text-base font-extrabold">WhatsApp</a> : null}
      </div>
    </div>
  );
}

/** The customer and vehicle boxes every customer link shows, the VIN once. */
export function customerBoxes(customer: { full_name?: string | null; company_name?: string | null; phone?: string | null } | null, vehicle: { kind?: string | null; variant?: string | null; vin?: string | null; plate?: string | null; title: string } | null): FrontBox[] {
  const out: FrontBox[] = [];
  if (customer) out.push({ title: "Customer", strong: customer.company_name ?? customer.full_name ?? "Customer", rows: [["", customer.company_name ? customer.full_name : null], ["", customer.phone ?? null]] });
  if (vehicle) {
    out.push(
      vehicle.kind === "loose"
        ? { title: "Items", strong: vehicle.variant ?? "Loose items", rows: [] }
        : { title: "Vehicle", strong: vehicle.title, rows: [["", vehicle.variant ?? null], ["Plate", vehicle.plate ?? null], ["VIN", vehicle.vin ?? null]] },
    );
  }
  return out;
}

/** The advisor behind a customer page: the one who sent the link, else the one who gated the car in. */
export async function advisorContact(admin: SupabaseClient, ids: (string | null | undefined)[]): Promise<{ name: string; phone: string | null } | null> {
  const id = ids.find((x): x is string => !!x);
  if (!id) return null;
  const [{ data: s }, { data: p }] = await Promise.all([admin.from("staff").select("display_name").eq("id", id).maybeSingle(), admin.from("staff_private").select("phone").eq("staff_id", id).maybeSingle()]);
  return s ? { name: s.display_name as string, phone: (p?.phone as string | null) ?? null } : null;
}
