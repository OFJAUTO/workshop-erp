"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { CarPicture } from "@/components/CarPicture";
import { PriorityBadge, TimingBadge } from "@/components/JobBadges";
import { StageTrack } from "@/components/StageTrack";
import {Badge, Card, Empty, SectionLabel, Select} from "@/components/ui";
import { PENDING_GROUPS, STATUS_LABELS, type JobStatus, type Priority, type Stage, type Timing } from "@/lib/jobs";

/** One car on the dashboard, already shaped on the server so the list can be filtered and sorted here. */
export type DashRow = {
  id: string;
  /** Items without a car: no inspection, no wash. */
  loose: boolean;
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
  statusLine: string;
  inspectionLabel: string | null;
  urgency: (number | string)[];
  /** The job's worst document alert ("Report not sent · 25 min", "Quotation sent 14:05"), or none. */
  docAlert: { text: string; tone: "muted" | "amber" | "red" | "green" } | null;
  /** A document past its first limit: counted in the Pending row as "Not sent". */
  notSent: boolean;
  /** Parts pressed Pricing done and the quotation is still being built or waits for the customer. */
  priced: boolean;
  /** Section 4: the advisor in charge (small badge on the card) and whether the car is the viewer's own. */
  advisorName: string | null;
  mine: boolean;
};

/** The small advisor-in-charge badge: initial circle + name, on every car card. */
export function AdvisorBadge({ name, compact = false }: { name: string | null; compact?: boolean }) {
  if (!name) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-1.5 py-0.5 text-[11px] font-bold" title={`Advisor in charge: ${name}`} data-advisor-badge={name}>
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink text-[9px] font-extrabold text-white">{name.trim().charAt(0).toUpperCase()}</span>
      {compact ? null : <span className="max-w-24 truncate">{name}</span>}
    </span>
  );
}

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



/** Search, sort, the four tiles and the Pending chips, all working together on the same list. */
export function DashboardCars({ rows, initialPending, advisorView = false }: { rows: DashRow[]; initialPending?: string; /** Section 4: an advisor sees My cars first, Other cars folded below, with a Mine/All switch. */ advisorView?: boolean }) {
  const [sort, setSort] = useStoredSort();
  const [tile, setTile] = useState<TileKey>("all");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [pending, setPending] = useState<string | null>(PENDING_GROUPS.some((g) => g.key === initialPending) || initialPending === "not_sent" ? (initialPending as string) : null);

  const tileDef = TILES.find((t) => t.key === tile) ?? TILES[0];
  const searched = rows.filter((r) => tileDef.match(r));
  const group = PENDING_GROUPS.find((g) => g.key === pending);
  const visible = sortRows(pending === "not_sent" ? searched.filter((r) => r.notSent) : group ? searched.filter((r) => group.statuses.includes(r.status)) : searched, sort);
  const filtered = tile !== "all" || !!group || pending === "not_sent";
  // Only stages with something in them appear in the dropdown.
  const stageOptions = [
    ...PENDING_GROUPS.map((g) => ({ key: g.key, label: g.label, count: searched.filter((r) => g.statuses.includes(r.status)).length })).filter((o) => o.count > 0),
    ...(searched.some((r) => r.notSent) ? [{ key: "not_sent", label: "Not sent", count: searched.filter((r) => r.notSent).length }] : []),
  ];

  return (
    <>
      {/* The summary in ONE slim row: label and number on one line; the explanation lives in the tooltip. */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2" data-summary-row>
        {TILES.map((t) => {
          const active = tile === t.key;
          const n = rows.filter(t.match).length;
          const color = n === 0 ? "text-muted" : { ink: "text-ink", amber: "text-amber", red: "text-red", green: "text-green" }[t.tone];
          return (
            <button
              key={t.key}
              type="button"
              title={t.caption}
              onClick={() => setTile(active && t.key !== "all" ? "all" : t.key)}
              aria-pressed={active}
              data-summary-tile={t.key}
              className={`flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-card border bg-white px-3 py-2 text-left hover:border-ink ${active ? "border-2 border-ink" : "border-line"}`}
            >
              <span className="truncate text-sm font-semibold">{t.label}</span>
              <span className={`text-xl font-extrabold leading-none ${color}`}>{n}</span>
            </button>
          );
        })}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Cars{filtered ? ` · ${visible.length} of ${rows.length}` : ""}</SectionLabel>
          <span className="flex flex-wrap items-center gap-3">
            {advisorView ? (
              <span className="inline-flex rounded-control border border-line-strong bg-white p-0.5" data-scope-switch>
                {(["mine", "all"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setScope(s)} aria-pressed={scope === s} data-scope={s} className={`min-h-10 rounded-control px-3 text-sm font-bold ${scope === s ? "bg-ink text-white" : "text-muted"}`}>
                    {s === "mine" ? `My cars (${searched.filter((r) => r.mine).length})` : `All (${searched.length})`}
                  </button>
                ))}
              </span>
            ) : null}
            <label className="flex items-center gap-2 text-sm font-semibold text-muted">
              <span>Stage</span>
              <Select value={pending ?? ""} onChange={(e) => setPending(e.target.value || null)} aria-label="Stage filter" className="min-w-44" data-stage-filter>
                <option value="">All</option>
                {stageOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label} ({o.count})
                  </option>
                ))}
              </Select>
            </label>
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
          </span>
        </div>
        {visible.length === 0 ? (
          <Empty title={rows.length === 0 ? "No cars in the workshop" : "No cars match"}>
            {filtered ? (
              <button
                type="button" onClick={() => { setTile("all"); setPending(null); }}
                className="min-h-11 rounded-control border border-line-strong bg-white px-4 text-sm font-bold"
              >
                Show all cars
              </button>
            ) : null}
          </Empty>
        ) : (() => {
          const card = (j: DashRow, dim = false) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className={`block ${dim ? "opacity-75" : ""}`} data-flash-id={j.id}>
              <Card className="flex flex-col md:flex-row md:items-center gap-5 hover:border-ink">
                <CarPicture url={j.pictureUrl} alt={j.plate} className="w-full md:w-56" />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[17px] font-extrabold tracking-[0.03em]">{j.plate}</span>
                    {j.vip ? <Badge tone="ink">VIP</Badge> : null}
                    {j.loose ? <Badge tone="ink">Loose items</Badge> : null}
                    <PriorityBadge priority={j.priority} />
                    <TimingBadge timing={j.timing} />
                    {j.inspectionLabel && j.timing.tone !== "red" ? <Badge tone="neutral">{j.inspectionLabel}</Badge> : null}
                    <AdvisorBadge name={j.advisorName} />
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
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold">{j.statusLine || STATUS_LABELS[j.status]}</span>
                    {j.docAlert ? <Badge tone={j.docAlert.tone === "muted" ? "neutral" : j.docAlert.tone}>{j.docAlert.text}</Badge> : null}
                    {j.priced ? <Badge tone="green">Priced</Badge> : null}
                  </span>
                  <StageTrack stage={j.stage} timing={j.timing} skip={j.loose ? ["inspection", "wash"] : undefined} roadTest={j.status === "pending_road_test" ? "waiting" : null} />
                </div>
              </Card>
            </Link>
          );
          if (!(advisorView && scope === "mine")) return <div className="flex flex-col gap-3">{visible.map((j) => card(j))}</div>;
          const mineRows = visible.filter((r) => r.mine);
          const otherRows = visible.filter((r) => !r.mine);
          return (
            <div className="flex flex-col gap-3">
              {mineRows.length ? mineRows.map((j) => card(j)) : <p className="text-sm text-muted" data-no-mine>No cars under your name right now. The switch above shows all cars.</p>}
              {otherRows.length ? (
                <details className="rounded-card border border-line bg-white" data-other-cars>
                  <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-bold text-muted">Other cars ({otherRows.length})</summary>
                  <div className="flex flex-col gap-3 p-3 pt-0">{otherRows.map((j) => card(j, true))}</div>
                </details>
              ) : null}
            </div>
          );
        })()}
      </section>
    </>
  );
}

