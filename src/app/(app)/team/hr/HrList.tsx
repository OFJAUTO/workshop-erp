"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui";
import { HR_TONE_RANK } from "@/lib/hr-rules";
import type { HrBoardRow } from "@/lib/hr";
import { openStaffFile } from "./actions";

/**
 * THE HR list (13 November 2026, Section 13): search as you type (name, role, department, phone), the four tiles as
 * filters, groups by department and team (folding, with chips to jump), Support staff on its own, one status line
 * per person, "Needs attention first" or A-Z.
 */
type Filter = "expired" | "expiring" | "missing" | "probation";
const TONE_CLASS: Record<HrBoardRow["line"]["tone"], string> = { red: "text-red", amber: "text-amber-text", grey: "text-muted", green: "text-green-text" };
const anchorOf = (g: string) => `hr-g-${g.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export function HrList({ rows }: { rows: HrBoardRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter | null>(null);
  const [sort, setSort] = useState<"attention" | "az">("attention");
  const tiles: { key: Filter; label: string; count: number; tone: string }[] = [
    { key: "expired", label: "Expired", count: rows.filter((r) => r.line.expired > 0).length, tone: "border-red-bar" },
    { key: "expiring", label: "Expiring in 60 days", count: rows.filter((r) => r.expiring60).length, tone: "border-amber-bar" },
    { key: "missing", label: "Documents missing", count: rows.filter((r) => r.line.missing > 0).length, tone: "border-line-strong" },
    { key: "probation", label: "On probation", count: rows.filter((r) => r.probation).length, tone: "border-line-strong" },
  ];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return rows
      .filter((r) => {
        if (filter === "expired" && !r.line.expired) return false;
        if (filter === "expiring" && !r.expiring60) return false;
        if (filter === "missing" && !r.line.missing) return false;
        if (filter === "probation" && !r.probation) return false;
        if (!needle) return true;
        if (`${r.name} ${r.role} ${r.group}`.toLowerCase().includes(needle)) return true;
        return digits.length >= 3 && (r.phone ?? "").replace(/\D/g, "").includes(digits);
      })
      .sort((a, b) => (sort === "attention" ? HR_TONE_RANK[a.line.tone] - HR_TONE_RANK[b.line.tone] : 0) || a.name.localeCompare(b.name));
  }, [rows, q, filter, sort]);
  const groups = useMemo(() => {
    const order = (g: string) => (g.startsWith("Mechanical") ? 0 : g.startsWith("Bodyshop") ? 1 : g.startsWith("Office") ? 2 : g === "Support staff" ? 3 : 4);
    const m = new Map<string, HrBoardRow[]>();
    for (const r of shown) m.set(r.group, [...(m.get(r.group) ?? []), r]);
    return Array.from(m.entries()).sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [shown]);

  return (
    <div className="flex flex-col gap-4" data-hr-board>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, role, department or phone"
        className="min-h-12 w-full rounded-control border border-line-strong bg-white px-4 text-base"
        data-hr-search
        autoComplete="off"
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-hr-tiles>
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(filter === t.key ? null : t.key)}
            aria-pressed={filter === t.key}
            className={`flex min-h-16 flex-col items-start justify-center rounded-card border-2 px-4 py-2 text-left ${filter === t.key ? "border-ink bg-ink text-on-dark" : `${t.tone} bg-white`}`}
            data-hr-tile={t.key}
            data-count={t.count}
          >
            <span className="text-2xl font-bold">{t.count}</span>
            <span className="text-sm font-semibold">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-muted">Sort:</span>
        {(
          [
            ["attention", "Needs attention first"],
            ["az", "A-Z"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k} className={`min-h-11 rounded-control border px-3 text-sm font-bold ${sort === k ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-hr-sort={k}>
            {label}
          </button>
        ))}
        <span className="ml-auto text-sm text-muted" data-hr-shown>{shown.length} of {rows.length}</span>
      </div>
      {groups.length > 1 ? (
        <nav className="flex flex-wrap gap-1.5" data-hr-chips>
          {groups.map(([g, list]) => (
            <a key={g} href={`#${anchorOf(g)}`} className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-white px-3 text-xs font-bold" data-hr-chip={g}>
              {g} ({list.length})
            </a>
          ))}
        </nav>
      ) : null}
      {groups.length === 0 ? <p className="text-sm text-muted">Nobody matches.</p> : null}
      {groups.map(([g, list]) => (
        <details key={g} open id={anchorOf(g)} className="rounded-card border border-line bg-white" data-hr-group={g}>
          <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 text-sm font-bold uppercase tracking-wide">
            {g}
            <span className="ml-auto text-muted">{list.length}</span>
          </summary>
          <ul className="flex flex-col divide-y divide-line border-t border-line">
            {list.map((r) => (
              <li key={r.key} className="flex min-h-16 items-center gap-3 px-4 py-2" data-hr-row={r.personId ?? r.staffId} data-hr-tone={r.line.tone}>
                <Avatar name={r.name} photoUrl={r.photoUrl} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold uppercase">{r.name}</span>
                  <span className="block text-xs text-muted">{[r.role, r.login ? null : "No ERP login"].filter(Boolean).join(" · ")}</span>
                  <span className={`block text-sm font-semibold ${TONE_CLASS[r.line.tone]}`} data-hr-status>
                    {r.line.words}
                    <span className="font-normal text-muted"> · {r.line.have} of {r.line.total} documents</span>
                  </span>
                </span>
                {r.personId ? (
                  <Link href={`/team/hr/${r.personId}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-hr-open={r.personId}>
                    Open
                  </Link>
                ) : (
                  <form action={openStaffFile.bind(null, r.staffId as string)}>
                    <button type="submit" className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-hr-open-staff={r.staffId}>
                      Open
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
