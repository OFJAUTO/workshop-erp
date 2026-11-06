"use client";

import Form from "next/form";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { controlClass } from "@/components/ui";
import { JOB_DEPARTMENTS, JOB_SORTS, JOB_WHEN, jobFilterQuery, type JobFilters } from "@/lib/job-list";

type Option = { value: string; label: string };

/**
 * THE jobs list controls (6 November 2026, Section 6): the sorts, the "when" chips, the one-tap filters, the search
 * and the longer lists (stage, advisor, technician) as drop-downs that apply at once. Every choice is a plain address,
 * so the list works the same on a tablet and a computer, and the person's choice is remembered on this device.
 */
export function JobListControls({ basePath, keep, filters, stages, advisors, technicians, shown, staffCookie, rememberQuery }: { basePath: string; keep: Record<string, string>; filters: JobFilters; stages: Option[]; advisors: Option[]; technicians: Option[]; shown: string; staffCookie: string; rememberQuery: string }) {
  // Remember this person's choice on this device (the page uses it when the address carries none).
  useEffect(() => {
    try {
      document.cookie = `${staffCookie}=${encodeURIComponent(rememberQuery)}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* no cookies: the list still works, it just starts from the default */
    }
  }, [staffCookie, rememberQuery]);
  const formRef = useRef<HTMLFormElement>(null);
  const href = (change: Partial<JobFilters>) => {
    const q = new URLSearchParams(keep);
    const next = new URLSearchParams(jobFilterQuery({ ...filters, ...change }));
    next.forEach((v, k) => q.set(k, v));
    if (![...next.keys()].length) q.set("reset", "1");
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const chip = (on: boolean) => `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink"}`;
  const submit = () => formRef.current?.requestSubmit();
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-white p-3" data-job-list-controls>
      <Form ref={formRef} action={basePath} className="flex flex-wrap items-end gap-2" data-allow-resubmit="" data-job-list-form>
        {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {filters.sort !== "newest" ? <input type="hidden" name="sort" value={filters.sort} /> : null}
        {filters.when !== "any" ? <input type="hidden" name="when" value={filters.when} /> : null}
        {filters.dept ? <input type="hidden" name="dept" value={filters.dept} /> : null}
        {filters.high ? <input type="hidden" name="high" value="1" /> : null}
        {filters.overdue ? <input type="hidden" name="overdue" value="1" /> : null}
        {filters.ready ? <input type="hidden" name="ready" value="1" /> : null}
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold text-muted">
          Search plate, VIN, job or make
          <input name="q" type="search" defaultValue={filters.q} placeholder="DD 23864, J-00985, Audi A8…" className={controlClass} data-job-list-search />
        </label>
        <label className="flex min-w-40 flex-col gap-1 text-xs font-semibold text-muted">
          Stage
          <select name="stage" defaultValue={filters.stage ?? ""} onChange={submit} className={controlClass} data-job-list-stage>
            <option value="">Every stage</option>
            {stages.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        {advisors.length ? (
          <label className="flex min-w-40 flex-col gap-1 text-xs font-semibold text-muted">
            Advisor
            <select name="advisor" defaultValue={filters.advisor ?? ""} onChange={submit} className={controlClass} data-job-list-advisor>
              <option value="">Every advisor</option>
              {advisors.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        ) : null}
        {technicians.length ? (
          <label className="flex min-w-40 flex-col gap-1 text-xs font-semibold text-muted">
            Technician
            <select name="tech" defaultValue={filters.tech ?? ""} onChange={submit} className={controlClass} data-job-list-tech>
              <option value="">Every technician</option>
              {technicians.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        ) : null}
        <button type="submit" className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-white" data-job-list-go>Search</button>
      </Form>
      <div className="flex flex-wrap items-center gap-2" data-job-list-sorts>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Sort</span>
        {JOB_SORTS.map((s) => <Link key={s.key} href={href({ sort: s.key })} className={chip(filters.sort === s.key)} data-job-sort={s.key} aria-current={filters.sort === s.key ? "true" : undefined}>{s.label}</Link>)}
      </div>
      <div className="flex flex-wrap items-center gap-2" data-job-list-filters>
        {JOB_WHEN.map((w) => <Link key={w.key} href={href({ when: w.key })} className={chip(filters.when === w.key)} data-job-when={w.key}>{w.label}</Link>)}
        {JOB_DEPARTMENTS.map((d) => <Link key={d.key} href={href({ dept: filters.dept === d.key ? null : d.key })} className={chip(filters.dept === d.key)} data-job-dept={d.key}>{d.label}</Link>)}
        <Link href={href({ high: !filters.high })} className={chip(filters.high)} data-job-filter="high">High priority</Link>
        <Link href={href({ overdue: !filters.overdue })} className={chip(filters.overdue)} data-job-filter="overdue">Overdue</Link>
        <Link href={href({ ready: !filters.ready })} className={chip(filters.ready)} data-job-filter="ready">Ready to collect</Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold" data-job-list-shown>{shown}</span>
        {rememberQuery ? <Link href={`${basePath}?${new URLSearchParams({ ...keep, reset: "1" }).toString()}`} className="inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4" data-job-list-clear>Clear all</Link> : null}
      </div>
    </div>
  );
}
