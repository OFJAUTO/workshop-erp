import { STAGE_LABELS, STAGES, type Stage, type Timing } from "@/lib/jobs";
import type { StageBoxState } from "@/lib/stage-style";

/**
 * THE slim stage bar of the approved dashboard design (29 October 2026, batch section 2): one 6 px bar per step with
 * its label underneath, finished steps black, the current step in its timing colour with its label in bold, steps
 * not reached grey. It never cuts off and never breaks a word: when the card is narrow (a phone, a tablet held
 * upright) the labels turn to their short form ("Insp.", "Appr.") through a container query.
 */
const NOW: Record<Timing["tone"], string> = { green: "bg-green", amber: "bg-amber-bar", red: "bg-red-bar", neutral: "bg-ink" };

/** Short labels for narrow cards; every one fits a ninth of a phone card at 10 px. */
export const STAGE_SHORT: Record<Stage, string> = {
  gate_in: "Gate",
  inspection: "Insp.",
  quote: "Quote",
  approval: "Appr.",
  parts: "Parts",
  work: "Work",
  qc: "QC",
  wash: "Wash",
  ready: "Ready",
};

export function StageBar({ stage, timing, skip, states = null }: { stage: Stage; timing: Timing; /** Steps this job never takes (loose items). */ skip?: Stage[]; /** The fact-driven state per stage; without it the position decides. */ states?: Partial<Record<Stage, StageBoxState>> | null }) {
  const stages = skip?.length ? STAGES.filter((s) => !skip.includes(s)) : [...STAGES];
  const current = stages.indexOf(stage);
  return (
    <div className="@container w-full min-w-0" data-stage-bar>
      <ol className="grid w-full gap-1" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((s, i) => {
          const state: StageBoxState = states?.[s] ?? (i < current ? "done" : i === current ? "current" : "later");
          const now = s === stage;
          const bar = state === "done" ? "bg-ink" : now ? NOW[timing.tone] : state === "current" ? "bg-amber-bar" : "bg-track";
          return (
            <li key={s} className="flex min-w-0 flex-col gap-1.5" data-stage-step={s} data-state={now ? "current" : state}>
              <span className={`h-1.5 rounded-full ${bar}`} />
              <span className={`whitespace-nowrap text-center text-[10px] leading-tight @[30rem]:text-[11px] ${now ? "font-extrabold text-ink" : state === "done" ? "font-semibold text-muted" : "font-medium text-[#8A8E96]"}`} title={STAGE_LABELS[s]}>
                <span className="@[34rem]:hidden">{STAGE_SHORT[s]}</span>
                <span className="hidden @[34rem]:inline">{STAGE_LABELS[s]}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
