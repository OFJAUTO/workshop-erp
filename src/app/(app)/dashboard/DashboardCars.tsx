"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { CarPicture } from "@/components/CarPicture";
import { PriorityBadge, TimingBadge } from "@/components/JobBadges";
import { StageTrack } from "@/components/StageTrack";
import { Badge, Card, Empty, Input, SectionLabel, Select } from "@/components/ui";
import { PENDING_GROUPS, STATUS_LABELS, type JobStatus, type Priority, type Stage, type Timing } from "@/lib/jobs";

/** One car on the dashboard, already shaped on the server so the list can be filtered and sorted here. */
export type DashRow = {
  id: string;
  jobNumber: string;
  plate: string;
  title: string;
  customer: string | null;
  assignee: string | null;
  vin: string | null;
  pictureUrl: string | null;
  vip: boolean;
  priority: Priority;
  status: JobStatus;
  stage: Stage;
  promisedAt: string | null;
  promisedLabel: string;
  gatedInAt: string | null;
  hoursInStage: number;
  conditionShort: string;
  dashCam: boolean;
  majorDamage: boolean;
  timing: Timing;
  urgency: (number | string)[];
};

const SORTS = [
  { key: "urgent", label: "Most urgent first" },
  { key: "newest", label: "Newest gate-in first" },
  { key: "oldest", label: "Oldest gate-in first" },
  { key: "stage", label: "Longest in current stage" },
  { key: "promised", label: "Promised date, soonest first" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];
const SORT_STORAGE_KEY = "erp_dashboard_sort";
const SORT_EVENT = "erp-dashboard-sort";

function isSort(v: unknown): v is SortKey {
  return SORTS.some((s) => s.key === v);
}

/** The person's last sort choice, kept on this device. Read in a way that never upsets the first render. */
function useStoredSort(): [SortKey, (s: SortKey) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      window.addEventListener(SORT_EVENT, cb);
      return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener(SORT_EVENT, cb);
      };
    },
    () => {
      try {
        const v = localStorage.getItem(SORT_STORAGE_KEY);
        return isSort(v) ? v : "urgent";
      } catch {
        return "urgent";
      }
    },
    () => "urgent" as SortKey,
  );
  const set = (s: SortKey) => {
    try {
      localStorage.setItem(SORT_STORAGE_KEY, s);
    } catch {}
    window.dispatchEvent(new Event(SORT_EVENT));
  };
  return [value, set];
}

function compareUrgency(a: DashRow, b: DashRow) {
  for (let i = 0; i < a.urgency.length; i++) if (a.urgency[i] !== b.urgency[i]) return a.urgency[i] < b.urgency[i] ? -1 : 1;
  return 0;
}

function sortRows(rows: DashRow[], sort: SortKey) {
  const out = [...rows];
  const ts = (v: string | null) => (v ? Date.parse(v) : 0);
  switch (sort) {
    case "newest":
      return out.sort((a, b) => ts(b.gatedInAt) - ts(a.gatedInAt) || compareUrgency(a, b));
    case "oldest":
      return out.sort((a, b) => ts(a.gatedInAt) - ts(b.gatedInAt) || compareUrgency(a, b));
    case "stage":
      return out.sort((a, b) => b.hoursInStage - a.hoursInStage || compareUrgency(a, b));
    case "promised":
      return out.sort((a, b) => (a.promisedAt ?? "9999").localeCompare(b.promisedAt ?? "9999") || compareUrgency(a, b));
    default:
      return out.sort(compareUrgency);
  }
}

type TileKey = "all" | "due" | "overdue" | "ready";
const TILES: { key: TileKey; label: string; caption: string; tone: "ink" | "amber" | "red" | "green"; match: (r: DashRow) => boolean }[] = [
  { key: "all", label: "In the workshop", caption: "All open cars", tone: "ink", match: () => true },
  { key: "due", label: "Due today", caption: "Promised for today", tone: "amber", match: (r) => !!r.promisedAt && r.timing.tone === "amber" },
  { key: "overdue", label: "Overdue or late", caption: "Past the promised date or over the stage target", tone: "red", match: (r) => r.timing.tone === "red" },
  { key: "ready", label: "Ready to collect", caption: "Job done, ready or pending payment", tone: "green", match: (r) => r.status === "ready" || r.status === "pending_payment" },
];

function normalise(s: string) {
  return s.toLowerCase().replace(/[\s·-]+/g, "");
}

function matchesQuery(r: DashRow, q: string) {
  if (!q) return true;
  const hay = normalise([r.plate, r.title, r.customer ?? "", r.vin ?? "", r.jobNumber, r.assignee ?? ""].join(" "));
  return q.split(/\s+/).every((part) => hay.includes(normalise(part)));
}

/** Search, sort, the four tiles and the Pending chips, all working together on the same list. */
export function DashboardCars({ rows, initialPending }: { rows: DashRow[]; initialPending?: string }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useStoredSort();
  const [tile, setTile] = useState<TileKey>("all");
  const [pending, setPending] = useState<string | null>(PENDING_GROUPS.some((g) => g.key === initialPending) ? (initialPending as string) : null);

  const tileDef = TILES.find((t) => t.key === tile) ?? TILES[0];
  const searched = rows.filter((r) => matchesQuery(r, query.trim()) && tileDef.match(r));
  const group = PENDING_GROUPS.find((g) => g.key === pending);
  const visible = sortRows(group ? searched.filter((r) => group.statuses.includes(r.status)) : searched, sort);
  const filtered = query.trim() || tile !== "all" || !!group;

  return (
    <>
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by plate, make, model, customer, VIN or job number"
          aria-label="Search cars"
          className="pr-12"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-control text-lg font-bold text-muted hover:bg-chip hover:text-ink"
          >
            ✕
          </button>
        ) : null}
      </div>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {TILES.map((t) => {
          const active = tile === t.key;
          const color = { ink: "text-ink", amber: "text-amber", red: "text-red", green: "text-green" }[t.tone];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTile(active && t.key !== "all" ? "all" : t.key)}
              aria-pressed={active}
              className={`text-left rounded-card border bg-white p-5 flex flex-col gap-1 min-h-11 cursor-pointer hover:border-ink ${active ? "border-ink ring-2 ring-ink" : "border-line"}`}
            >
              <span className="text-sm font-semibold text-muted">{t.label}</span>
              <span className={`text-4xl font-extrabold leading-none ${color}`}>{rows.filter(t.match).length}</span>
              <span className="text-xs text-faint">{t.caption}</span>
            </button>
          );
        })}
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Pending</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <PendingChip label="All" count={searched.length} active={!group} onClick={() => setPending(null)} />
          {PENDING_GROUPS.map((g) => (
            <PendingChip
              key={g.key}
              label={g.label}
              count={searched.filter((r) => g.statuses.includes(r.status)).length}
              active={group?.key === g.key}
              onClick={() => setPending(group?.key === g.key ? null : g.key)}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Cars{filtered ? ` · ${visible.length} of ${rows.length}` : ""}</SectionLabel>
          <label className="flex items-center gap-2 text-sm font-semibold text-muted">
            <span>Sort</span>
            <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort cars" className="min-w-56">
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {visible.length === 0 ? (
          <Empty title={rows.length === 0 ? "No cars in the workshop" : "No cars match"}>
            {filtered ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setTile("all");
                  setPending(null);
                }}
                className="min-h-11 rounded-control border border-line-strong bg-white px-4 text-sm font-bold"
              >
                Show all cars
              </button>
            ) : null}
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="block">
                <Card className="flex flex-col md:flex-row md:items-center gap-5 hover:border-ink">
                  <CarPicture url={j.pictureUrl} alt={j.plate} className="w-full md:w-56" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[17px] font-extrabold tracking-[0.03em]">{j.plate}</span>
                      {j.vip ? <Badge tone="ink">VIP</Badge> : null}
                      <PriorityBadge priority={j.priority} />
                      <TimingBadge timing={j.timing} />
                    </div>
                    <span className="text-sm font-semibold">{j.title}</span>
                    <span className="text-xs text-muted">
                      {j.assignee ?? j.customer ?? "Not assigned"}
                      {j.promisedLabel ? ` · ${j.promisedLabel}` : ""}
                      {j.conditionShort ? ` · ${j.conditionShort}` : ""}
                      {j.dashCam ? " · Dash cam" : ""}
                      {j.majorDamage ? " · Major damage" : ""}
                      {` · ${j.jobNumber}`}
                    </span>
                  </div>
                  <div className="md:flex-[2] min-w-0 flex flex-col gap-2.5">
                    <span className="text-sm font-bold">{STATUS_LABELS[j.status]}</span>
                    <StageTrack stage={j.stage} timing={j.timing} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function PendingChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center gap-2.5 rounded-full border px-4 text-sm font-semibold cursor-pointer ${active ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}
    >
      {label}
      <span className={`inline-flex min-w-6 h-6 items-center justify-center rounded-full px-1.5 text-xs font-bold ${active ? "bg-white text-ink" : "bg-ink text-white"}`}>
        {count}
      </span>
    </button>
  );
}
