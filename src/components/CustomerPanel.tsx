"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatPhone } from "@/lib/messages";

/**
 * THE owner details panel (29 October 2026, batch 2 section 1): tapping a customer's name anywhere (car card, job card,
 * gate-in page, search) opens this one panel - a pop-up on a computer, a sheet sliding up on a tablet or phone. Only
 * mounted for the owner, advisors and accounts, and its data route refuses everyone else.
 */
const EVENT = "erp:customer-panel";
type Open = { jobId?: string | null; customerId?: string | null };

export function openCustomerPanel(detail: Open) {
  window.dispatchEvent(new CustomEvent<Open>(EVENT, { detail }));
}

/** The customer's name as a button that opens the panel; it never opens the card or link it sits on. */
export function CustomerName({ name, jobId, customerId, className = "" }: { name: string; jobId?: string | null; customerId?: string | null; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openCustomerPanel({ jobId, customerId });
      }}
      className={`pointer-events-auto inline-flex min-h-9 max-w-full items-center text-left underline decoration-dotted underline-offset-4 ${className}`}
      data-customer-name
    >
      {name}
    </button>
  );
}

type PanelData = {
  customer: { id: string; number: string | null; name: string; kind: string; person: string | null; phone: string | null; phone2: string | null; email: string | null; vip: boolean };
  contacts: { name: string; phone: string | null; relationship: string | null; canApprove: boolean }[];
  job: { id: string; number: string } | null;
  arrived: string | null;
  approvedBy: { name: string; phone: string | null } | null;
  previous: { count: number; last: { id: string; number: string; date: string | null; car: string; total: number | null }[] };
  spentThisYear: number;
  openBalance: number;
  cars: { id: string; plate: string; car: string }[];
  declined: { id: string; title: string; date: string; severity?: string | null }[];
};

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso)) : "");
const digits = (p: string) => p.replace(/[^\d]/g, "");

function PhoneRow({ label, phone }: { label?: string; phone: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label ? <span className="text-xs text-muted">{label}</span> : null}
      <span className="font-semibold">{formatPhone(phone)}</span>
      <a href={`tel:+${digits(phone)}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold" data-panel-call>Call</a>
      <a href={`https://wa.me/${digits(phone)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold" data-panel-whatsapp>WhatsApp</a>
    </div>
  );
}

export function CustomerPanelHost() {
  const [open, setOpen] = useState<Open | null>(null);
  const [data, setData] = useState<PanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pushed = useRef(false);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<Open>).detail;
      setOpen(detail);
      setData(null);
      setError(null);
      const q = detail.jobId ? `job=${encodeURIComponent(detail.jobId)}` : `customer=${encodeURIComponent(detail.customerId ?? "")}`;
      fetch(`/api/customer-panel?${q}`, { cache: "no-store" })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error ?? "Could not load the customer.");
          setData(j as PanelData);
        })
        .catch((err: Error) => setError(err.message));
      // The phone's back button closes the panel, not the page.
      if (!pushed.current) {
        history.pushState({ erpCustomerPanel: true }, "");
        pushed.current = true;
      }
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPop = () => {
      pushed.current = false;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  });

  function close() {
    if (pushed.current) {
      pushed.current = false;
      history.back();
    }
    setOpen(null);
  }
  /** A link inside the panel navigates itself: close without stepping back in history first. */
  function leave() {
    pushed.current = false;
    setOpen(null);
  }

  if (!open) return null;
  const c = data?.customer;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 nav:items-center nav:p-6" onClick={close} data-customer-panel-backdrop>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Customer details"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full flex-col overflow-y-auto rounded-t-card bg-white p-5 shadow-xl nav:max-h-[calc(100dvh-3rem)] nav:max-w-xl nav:rounded-card"
        data-customer-panel
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted">Customer</span>
            <span className="text-xl font-extrabold uppercase" data-panel-name>{c?.name ?? (error ? "" : "Loading…")}</span>
            {c ? (
              <span className="text-sm text-muted">
                {[c.number, c.kind, c.person ? `contact: ${c.person}` : null].filter(Boolean).join(" · ")}
                {c.vip ? " · VIP" : ""}
              </span>
            ) : null}
          </div>
          <button type="button" onClick={close} aria-label="Close" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-2xl font-bold hover:bg-chip" data-panel-close>
            ✕
          </button>
        </div>
        {error ? <p className="mt-4 text-sm font-semibold text-red" data-panel-error>{error}</p> : null}
        {data && c ? (
          <div className="mt-4 flex flex-col gap-4 text-sm">
            <section className="flex flex-col gap-2" data-panel-contact>
              {c.phone ? <PhoneRow phone={c.phone} /> : <span className="text-muted">No phone on record</span>}
              {c.phone2 ? <PhoneRow label="Second phone" phone={c.phone2} /> : null}
              {c.email ? <a href={`mailto:${c.email}`} className="font-semibold underline underline-offset-4">{c.email}</a> : null}
              {data.contacts.map((p) => (
                <div key={`${p.name}${p.phone}`} className="flex flex-col gap-1 border-t border-line pt-2">
                  <span className="font-semibold">{p.name}{p.relationship ? <span className="font-normal text-muted"> · {p.relationship}</span> : null}{p.canApprove ? <span className="font-normal text-muted"> · may approve</span> : null}</span>
                  {p.phone ? <PhoneRow phone={p.phone} /> : null}
                </div>
              ))}
            </section>
            {data.arrived || data.approvedBy ? (
              <section className="flex flex-col gap-1 border-t border-line pt-3" data-panel-dropoff>
                {data.arrived ? <span className="font-semibold">{data.arrived}</span> : null}
                {data.approvedBy ? (
                  <span>
                    Job card approved by <span className="font-semibold">{data.approvedBy.name}</span>
                    {data.approvedBy.phone ? <> · <a href={`tel:+${digits(data.approvedBy.phone)}`} className="underline underline-offset-4">{formatPhone(data.approvedBy.phone)}</a></> : null}
                  </span>
                ) : null}
              </section>
            ) : null}
            <section className="flex flex-col gap-1 border-t border-line pt-3" data-panel-history>
              <span className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted">Previous jobs · {data.previous.count}</span>
              {data.previous.last.map((j) => (
                <Link key={j.id} href={`/jobs/${j.id}`} onClick={leave} className="flex flex-wrap justify-between gap-x-3 py-1 hover:underline">
                  <span><span className="font-semibold">{day(j.date)}</span> · {j.number} · {j.car}</span>
                  <span className="font-semibold">{j.total !== null ? aed(j.total) : "—"}</span>
                </Link>
              ))}
              <span className="flex flex-wrap gap-x-4 pt-1">
                <span>Spent this year: <span className="font-semibold">{aed(data.spentThisYear)}</span></span>
                {data.openBalance > 0 ? <span className="font-semibold text-red" data-panel-balance>Open balance: {aed(data.openBalance)}</span> : null}
              </span>
            </section>
            {data.cars.length ? (
              <section className="flex flex-col gap-1 border-t border-line pt-3" data-panel-cars>
                <span className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted">Other cars with us · {data.cars.length}</span>
                {data.cars.map((v) => (
                  <Link key={v.id} href={`/vehicles/${v.id}`} onClick={leave} className="py-1 hover:underline">
                    <span className="font-semibold uppercase">{v.plate}</span> · {v.car}
                  </Link>
                ))}
              </section>
            ) : null}
            {data.declined.length ? (
              <section className="flex flex-col gap-1 border-t border-line pt-3" data-panel-declined>
                <span className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted">Declined work from earlier visits</span>
                {data.declined.map((d) => (
                  <span key={d.id}>
                    <span className="font-semibold">{day(d.date)}</span> · {d.title}{d.severity ? <span className="text-muted"> · {d.severity}</span> : null}
                  </span>
                ))}
              </section>
            ) : null}
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Link href={`/customers/${c.id}`} onClick={leave} className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white" data-panel-customer-page>Open customer page</Link>
              {data.job ? <Link href={`/jobs/${data.job.id}/gate-in`} onClick={leave} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-panel-gate-in>Gate-in details</Link> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
