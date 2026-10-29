"use client";

import Link from "next/link";
import { useState } from "react";
import { assignJob } from "@/app/(app)/jobs/actions";
import { Badge, Button, Card, ChoiceButtons, Empty, Textarea } from "@/components/ui";
import { StaffPicker } from "@/components/StaffPicker";
import { CarCard } from "@/components/CarCard";
import type { TechnicianLoad } from "@/lib/technician-load";
import type { Side } from "@/lib/teams";

export type BoardCar = {
  id: string;
  plate: string;
  car: string;
  customer: string;
  jobNumber: string;
  department: string | null;
  pictureUrl: string | null;
  need: string;
  waited: string;
  tone: "red" | "amber" | "none";
  vip: boolean;
  high: boolean;
  doesNotRun: boolean;
  requests: string[];
  gateInNotes: string | null;
  advisorNote: { by: string; text: string } | null;
  canAssign: boolean;
  blockedWhy: string | null;
  roadTestSuggested: boolean;
  defaultRoadTest: string | null;
};

const ROAD_TEST_CHOICES = [
  { value: "needed", label: "Road test first" },
  { value: "not_needed", label: "No road test" },
  { value: "not_possible", label: "Not possible" },
];

/** Section 6 (21 October 2026): cars on the LEFT, one assign panel on the RIGHT with the team grouped
 *  under team headers - the team list appears ONCE, never under each car. Tablet-friendly, 14px+. */
export function AssignBoard({ cars, people }: { cars: BoardCar[]; people: TechnicianLoad[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(cars.find((c) => c.canAssign)?.id ?? null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const selected = cars.find((c) => c.id === selectedId) ?? null;
  const sides: Side[] = selected?.department === "bodyshop" ? ["bodyshop"] : selected?.department === "both" ? ["mechanical", "bodyshop"] : ["mechanical"];
  const isBodyshopOnly = selected?.department === "bodyshop";
  const pick = (id: string) => { setSelectedId(id); setTicked(new Set()); };
  const shownSides = sides.filter((s) => people.some((p) => p.side === s));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(380px,440px)] gap-4 items-start" data-assign-board>
      {/* LEFT: the cars waiting. */}
      <div className="flex flex-col gap-2" data-assign-cars>
        {cars.length === 0 ? <Empty title="Nothing waiting to be assigned" /> : null}
        {cars.map((c) => (
          <CarCard
            key={c.id}
            onPick={() => pick(c.id)}
            selected={selectedId === c.id}
            tone={c.tone}
            dim={!c.canAssign}
            data-assign-car={c.id}
            pictureUrl={c.pictureUrl}
            plate={c.plate}
            title={c.car}
            sub={[c.customer, c.jobNumber]}
            chips={
              <>
                {c.vip ? <Badge tone="ink">VIP</Badge> : null}
                {c.high ? <Badge tone="outline">High priority</Badge> : null}
                {c.doesNotRun ? <Badge tone="red">Does not run</Badge> : null}
                <Badge tone="neutral">{c.department === "bodyshop" ? "Bodyshop" : c.department === "both" ? "Both sides" : "Mechanical"}</Badge>
              </>
            }
            status={{ line: c.need, detail: `waiting ${c.waited}` }}
          />
        ))}
      </div>

      {/* RIGHT: tap a car, assign its people - the ONE team list. */}
      <Card className="lg:sticky lg:top-20 nav:top-4 flex flex-col gap-3 p-4" data-assign-panel>
        {!selected ? (
          <p className="text-[14px] text-muted">Tap a car on the left to assign it.</p>
        ) : (
          <>
            <div className="flex flex-col gap-0.5">
              <span className="text-[17px] font-extrabold tracking-[0.03em]">{selected.plate}</span>
              <span className="text-[14px] font-semibold">{selected.car}</span>
              <Link href={`/jobs/${selected.id}`} className="text-[13px] font-semibold underline underline-offset-4">Open the job card</Link>
            </div>
            {selected.requests.length ? (
              <ol className="flex flex-col gap-1 rounded-control bg-chip px-3 py-2 text-[14px]">
                {selected.requests.map((t, i) => <li key={i} className="flex gap-2"><span className="w-5 shrink-0 text-muted">{i + 1}.</span><span className="font-semibold">{t}</span></li>)}
              </ol>
            ) : null}
            {selected.gateInNotes ? <p className="text-[13px]"><span className="font-bold">Gate-in notes:</span> {selected.gateInNotes}</p> : null}
            {selected.advisorNote ? <p className="rounded-control bg-chip px-3 py-2 text-[13px]"><span className="font-bold">Note from {selected.advisorNote.by}:</span> {selected.advisorNote.text}</p> : null}
            {!selected.canAssign ? (
              <p className="rounded-control bg-amber-soft px-3 py-2 text-[14px] font-semibold" data-assign-blocked>{selected.blockedWhy ?? "This car cannot be assigned yet."}</p>
            ) : (
              <form action={assignJob.bind(null, selected.id)} className="flex flex-col gap-3" data-assign-form>
                <input type="hidden" name="back" value="/assign" />
                <StaffPicker key={selected.id} mode="tick" people={people} sides={shownSides.length ? shownSides : sides} value={[...ticked]} onChange={(ids) => setTicked(new Set(ids))} showLoad={false} />
                {!isBodyshopOnly && (shownSides.length ? shownSides : sides).includes("mechanical") ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-[14px] font-semibold">Road test{selected.roadTestSuggested ? <span className="ml-2 rounded-control bg-amber-soft px-2 py-0.5 text-[12px] font-bold text-amber">Suggested: the requests mention noise, vibration, steering or braking</span> : null}</span>
                    <ChoiceButtons name="road_test" columns={3} defaultValue={selected.defaultRoadTest} options={ROAD_TEST_CHOICES} />
                  </div>
                ) : <p className="text-[13px] text-muted" data-no-roadtest>Bodyshop car: no road test, no mechanical inspection. The car runs on the bodyshop board.</p>}
                <label className="flex flex-col gap-1">
                  <span className="text-[14px] font-semibold">Note <span className="font-medium text-muted">{isBodyshopOnly ? "(optional)" : "(required when the road test is not possible)"}</span></span>
                  <Textarea name="road_test_note" rows={1} placeholder={isBodyshopOnly ? "Anything the team should know" : "For example: does not start, or no plates"} />
                </label>
                <Button type="submit" size="lg" disabled={ticked.size === 0} data-assign-submit>Assign{ticked.size ? ` (${ticked.size})` : ""}</Button>
              </form>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
