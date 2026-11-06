"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { addRecentJob, readRecentJobs, recentJobsKey, type RecentJob } from "@/lib/job-list";

/**
 * Recently viewed jobs (6 November 2026, Section 6): the last five job cards one person opened on this device, as a
 * strip above the jobs list. Kept per person, so a shared tablet shows each person their own.
 */
const EVENT = "erp-recent-jobs";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** On a job card: remembers that this person opened it. */
export function RecentJobMark({ staffId, job }: { staffId: string; job: RecentJob }) {
  const { id, n, p, t } = job;
  useEffect(() => {
    try {
      const key = recentJobsKey(staffId);
      window.localStorage.setItem(key, JSON.stringify(addRecentJob(readRecentJobs(read(key)), { id, n, p, t })));
      window.dispatchEvent(new Event(EVENT));
    } catch {
      /* private window or storage off: nothing to remember */
    }
  }, [staffId, id, n, p, t]);
  return null;
}

const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
};

/** Above the jobs list: the last five opened, one tap each. */
export function RecentJobsStrip({ staffId }: { staffId: string }) {
  const key = recentJobsKey(staffId);
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const jobs = readRecentJobs(raw);
  if (!jobs.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-recent-jobs>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Recently viewed</span>
      {jobs.map((j) => (
        <Link key={j.id} href={`/jobs/${j.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong bg-white px-3 text-sm" data-recent-job={j.id}>
          <span className="font-bold">{j.p}</span>
          <span className="text-muted">{j.n}</span>
        </Link>
      ))}
    </div>
  );
}
