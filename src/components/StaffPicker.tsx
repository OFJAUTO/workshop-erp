"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui";
import { groupByTeam, type Side } from "@/lib/teams";
import type { TechnicianLoad } from "@/lib/technician-load";

const RING: Record<TechnicianLoad["status"], string> = { free: "ring-green", paused: "ring-amber-bar", working: "ring-red-bar" };
const BAR = (p: number) => (p < 60 ? "bg-green" : p <= 90 ? "bg-amber-bar" : "bg-red-bar");
const SIDE_WORD: Record<Side, string> = { mechanical: "Mechanical", bodyshop: "Bodyshop" };

type Common = {
  people: TechnicianLoad[];
  /** The car's sides, in order: one heading per side when there are two. */
  sides: Side[];
  /** People already on the car: left out of the list. */
  exclude?: string[];
  showLoad?: boolean;
  hint?: string | null;
  emptyText?: string;
};
type TickProps = Common & { mode: "tick"; name?: string; defaultChecked?: string[]; value?: string[]; onChange?: (ids: string[]) => void };
type TapProps = Common & { mode: "tap"; action: (formData: FormData) => void | Promise<void>; field?: string; fields?: Record<string, string>; tapWord?: string };
type ViewProps = Common & { mode: "view" };
type ChipsProps = Common & { mode: "chips"; action: (formData: FormData) => void | Promise<void>; field?: string; fields?: Record<string, string>; on: string[]; disabled?: boolean };

/**
 * THE staff picker (28 October 2026, B1): the same people, grouped the same way, on every screen where someone is put on
 * a car - the car's sides, each side's teams (PPF, Painting, Detailing & cleaning, Dismantle & refit; Technicians,
 * Electricians, Helpers), the team's leader at the top marked "Leader", then the others freest first, each with a
 * status ring (green free, amber on a car, red clock running), what they are doing now and their week's load.
 *   tick - tick one or more (hidden inputs named `name`, default "technician"); a busy person asks once
 *   tap  - one tap puts the person on the car through `action` (field `field`, default "technician", plus `fields`)
 *   view - the list only (Workshop load)
 *   chips - one compact chip per person on a car card (My section): a tap puts them on, a tap on a green chip takes them off ("off" = 1)
 */
export function StaffPicker(props: TickProps | TapProps | ViewProps | ChipsProps) {
  const { people, sides, exclude = [], showLoad = true, hint, emptyText } = props;
  const [inner, setInner] = useState<string[]>(props.mode === "tick" ? (props.defaultChecked ?? []) : []);
  const [ask, setAsk] = useState<string | null>(null);
  const ticked = props.mode === "tick" ? (props.value ?? inner) : [];
  const setTicked = (ids: string[]) => {
    if (props.mode !== "tick") return;
    if (props.onChange) props.onChange(ids);
    if (props.value === undefined) setInner(ids);
  };
  const toggle = (p: TechnicianLoad) => {
    if (ticked.includes(p.id)) return setTicked(ticked.filter((x) => x !== p.id));
    if (p.status !== "free" && ask !== p.id) return setAsk(p.id);
    setAsk(null);
    setTicked([...ticked, p.id]);
  };
  const groups = groupByTeam(people.filter((p) => !exclude.includes(p.id)), sides);
  const two = sides.length > 1;

  if (props.mode === "chips") {
    const list = groups.flatMap((g) => g.members);
    return (
      <span className="flex flex-wrap items-center gap-2" data-staff-picker data-staff-mode="chips">
        {list.map((p) => {
          const isOn = props.on.includes(p.id);
          return (
            <form key={p.id} action={props.action}>
              <input type="hidden" name={props.field ?? "technician"} value={p.id} />
              {Object.entries(props.fields ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {isOn ? <input type="hidden" name="off" value="1" /> : null}
              <button type="submit" disabled={props.disabled} data-pick-person={p.id} data-on={isOn ? "1" : "0"} className={`inline-flex min-h-11 items-center gap-2 rounded-control border px-2.5 text-sm font-bold ${isOn ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`} title={p.now}>
                <Avatar name={p.display_name} photoUrl={p.photoUrl} size={24} />{isOn ? "✓ " : ""}{p.display_name}
                {p.isLeader ? <span className="rounded-control bg-ink px-1 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-white" data-leader>Leader</span> : null}
              </button>
            </form>
          );
        })}
        {list.length === 0 ? <span className="text-xs text-muted">{emptyText ?? "Nobody in this team yet."}</span> : null}
      </span>
    );
  }

  const row = (p: TechnicianLoad) => {
    const on = ticked.includes(p.id);
    const face = (
      <>
        {props.mode === "tick" ? <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control border text-xs font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong text-transparent"}`}>✓</span> : null}
        <span className={`shrink-0 rounded-full ring-[3px] ${p.onBreak ? "ring-line-strong" : RING[p.status]}`}><Avatar name={p.display_name} photoUrl={p.photoUrl} size={36} /></span>
        <span className="min-w-[7rem] flex-1 flex flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold">{p.display_name}</span>
            {p.isLeader ? <span className="shrink-0 rounded-control bg-ink px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-white" data-leader>Leader</span> : null}
          </span>
          <span className={`truncate text-[12px] ${p.status === "free" && !p.onBreak ? "font-semibold text-green" : "text-muted"}`}>{p.now}</span>
          {p.cars.length ? (
            <span className="mt-0.5 flex flex-wrap gap-1">
              {p.cars.slice(0, 3).map((c) => <span key={c.jobId} className={`rounded-control border px-1.5 py-0.5 text-[11px] font-bold ${c.running ? "border-red-bar text-red" : "border-line text-muted"}`}>{c.plate}</span>)}
              {p.cars.length > 3 ? <span className="text-[11px] font-semibold text-muted">+{p.cars.length - 3}</span> : null}
            </span>
          ) : null}
        </span>
        {showLoad ? (
          <span className="flex w-24 shrink-0 flex-col items-end gap-0.5">
            <span className="text-[11px] font-semibold text-muted">{p.loadHours} of {Math.round(p.weekHours)} h</span>
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-track"><span className={`block h-full ${BAR(p.percent)}`} style={{ width: `${Math.min(100, p.percent)}%` }} /></span>
          </span>
        ) : null}
      </>
    );
    if (props.mode === "tap") {
      return (
        <form action={props.action} className="flex">
          <input type="hidden" name={props.field ?? "technician"} value={p.id} />
          {Object.entries(props.fields ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <button type="submit" data-pick-person={p.id} className="flex w-full min-h-12 items-center gap-3 rounded-control px-2 text-left hover:bg-chip" aria-label={`${props.tapWord ?? "Put on the car"}: ${p.display_name}`}>
            {face}
            <span className="shrink-0 rounded-control border border-ink px-2 py-1 text-[12px] font-bold">{props.tapWord ?? "+ Add"}</span>
          </button>
        </form>
      );
    }
    if (props.mode === "view") return <div className="flex w-full min-h-12 items-center gap-3 px-2" data-pick-person={p.id}>{face}</div>;
    return (
      <>
        <button type="button" onClick={() => toggle(p)} aria-pressed={on} data-pick-person={p.id} className={`flex w-full min-h-12 items-center gap-3 rounded-control px-2 text-left ${on ? "bg-chip" : ""}`}>{face}</button>
        {ask === p.id ? (
          <div className="flex flex-wrap items-center gap-2 rounded-control bg-amber-soft px-3 py-2 text-xs" data-pick-busy>
            <span className="font-semibold">{p.display_name} is {p.status === "working" ? "working on another car" : "already on a car"}. Put on this car as well?</span>
            <button type="button" onClick={() => toggle(p)} className="min-h-11 rounded-control bg-ink px-4 font-bold text-white">Yes</button>
            <button type="button" onClick={() => setAsk(null)} className="min-h-11 rounded-control border border-line px-4 font-semibold">No</button>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-3" data-staff-picker data-staff-mode={props.mode}>
      {props.mode === "tick" ? ticked.map((id) => <input key={id} type="hidden" name={props.name ?? "technician"} value={id} />) : null}
      {sides.map((side) => {
        const mine = groups.filter((g) => g.side === side);
        return (
          <div key={side} className="flex flex-col gap-2" data-side={side}>
            {two ? <span className="text-[13px] font-extrabold">{SIDE_WORD[side]}</span> : null}
            {mine.map((g) => (
              <div key={`${g.side}-${g.team.key}`} className="flex flex-col gap-0.5" data-team={g.team.key}>
                <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted">{g.team.label}</span>
                <ul className="flex flex-col">
                  {g.members.map((p) => <li key={p.id}>{row(p)}</li>)}
                </ul>
              </div>
            ))}
            {mine.length === 0 ? <p className="text-[13px] text-muted">{emptyText ?? (exclude.length && people.some((p) => p.side === side) ? `Everyone in the ${side === "bodyshop" ? "bodyshop" : "mechanical"} teams is already on the car.` : `Nobody in the ${side === "bodyshop" ? "bodyshop" : "mechanical"} teams yet. Set teams on the Team page.`)}</p> : null}
          </div>
        );
      })}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}
