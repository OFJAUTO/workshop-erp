/**
 * THE one source of truth for stage colours. The step bar at the top of the job card and the big stage
 * boxes under it both take their states and classes from here, so they can never disagree:
 *   done    = the whole box light green with a green border (title gets a ✓),
 *   current = the whole box light amber with an amber border (in progress),
 *   later   = the whole box light grey with grey text (not started).
 * Why an earlier fix looked like it only coloured the text: the Card base sets bg-white, and in Tailwind the
 * winner between two background classes is stylesheet order, not class order - so the appended tint lost and
 * the computed background stayed white (plus bg-green-soft/50 is invisible at half strength). The card
 * classes therefore use the ! (important) variants; the step bar needs no override and uses the plain ones.
 */
export type StageBoxState = "done" | "current" | "later";

export const STAGE_BOX_CLASS: Record<StageBoxState, string> = {
  done: "border border-green bg-green-soft",
  current: "border-2 border-amber-bar bg-amber-soft",
  later: "border border-line bg-chip",
};

/** The same look for a Card, whose own bg-white and border-line would otherwise win the stylesheet race. */
export const STAGE_BOX_CARD: Record<StageBoxState, string> = {
  done: "!border-green !bg-green-soft",
  current: "border-2 !border-amber-bar !bg-amber-soft",
  later: "!border-line !bg-chip",
};

export const STAGE_BOX_TITLE: Record<StageBoxState, string> = {
  done: "text-green",
  current: "text-ink",
  later: "text-muted",
};

/**
 * One state per stage from the real facts: a stage is done when its own thing happened (the fact), the FIRST
 * stage not done is current (in progress, amber), everything after is later (grey). The bar and the boxes
 * both read this map.
 */
export function stageStates<S extends string>(stages: readonly S[], doneOf: (stage: S, index: number) => boolean): Record<S, StageBoxState> {
  const flags = stages.map((s, i) => doneOf(s, i));
  const firstUndone = flags.findIndex((d) => !d);
  const out = {} as Record<S, StageBoxState>;
  stages.forEach((s, i) => {
    out[s] = flags[i] ? "done" : i === firstUndone ? "current" : "later";
  });
  return out;
}
