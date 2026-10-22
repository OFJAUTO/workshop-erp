"use client";

import { CAR_PANELS, type PanelShape, type PanelTone } from "@/lib/car-outline";

const FILL: Record<PanelTone | "none", string> = { none: "#FFFFFF", amber: "#FCE9C2", red: "#F6D1CE" };
const STROKE: Record<PanelTone | "none", string> = { none: "#A1A1AA", amber: "#B7791F", red: "#B3261E" };

function Shape({ s, fill, stroke, width, onClick, label, hook }: { s: PanelShape; fill: string; stroke: string; width: number; onClick?: () => void; label: string; hook: string }) {
  const common = { fill, stroke, strokeWidth: width, onClick, style: onClick ? { cursor: "pointer" } : undefined, "data-panel": hook, role: onClick ? "button" : undefined, "aria-label": label } as const;
  if (s.kind === "rect") return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r ?? 0} {...common}><title>{label}</title></rect>;
  if (s.kind === "circle") return <circle cx={s.cx} cy={s.cy} r={s.r} {...common}><title>{label}</title></circle>;
  return <path d={s.d} {...common}><title>{label}</title></path>;
}

/**
 * The car seen from above (front at the top): tap a panel to pick it. Marked panels are amber (minor) or red
 * (moderate, severe); the picked one has a black outline. One component for the inspection's bodyshop findings,
 * the gate-in damage marking and the bodyshop pre-work check; read-only when no onPick is given.
 */
export function CarOutline({ tones, selected = null, onPick, size = 220, showChassis = true }: { tones: Record<string, PanelTone | null | undefined>; selected?: string | null; onPick?: (panel: string) => void; size?: number; showChassis?: boolean }) {
  const chassis = CAR_PANELS.find((p) => p.key === "chassis")!;
  const chassisTone = tones.chassis ?? null;
  return (
    <div className="flex flex-col items-center gap-2" data-car-outline>
      <svg viewBox="0 0 240 480" width={size} height={size * 2} className="max-w-full" role="img" aria-label="Car outline, seen from above, front at the top">
        {CAR_PANELS.filter((p) => p.shape).map((p) => {
          const tone = tones[p.key] ?? null;
          return (
            <Shape
              key={p.key}
              s={p.shape!}
              fill={FILL[tone ?? "none"]}
              stroke={selected === p.key ? "#111113" : STROKE[tone ?? "none"]}
              width={selected === p.key ? 3 : 1.5}
              onClick={onPick ? () => onPick(p.key) : undefined}
              label={p.label}
              hook={p.key}
            />
          );
        })}
      </svg>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Front at the top · tap a panel</span>
      {showChassis ? (
        <button type="button" disabled={!onPick} onClick={() => onPick?.("chassis")} aria-pressed={selected === "chassis"} className={`min-h-11 rounded-control border-2 px-4 text-sm font-bold ${selected === "chassis" ? "border-ink" : chassisTone === "red" ? "border-red-bar" : chassisTone === "amber" ? "border-amber-bar" : "border-line-strong"} ${chassisTone === "red" ? "bg-red-soft" : chassisTone === "amber" ? "bg-amber-soft" : "bg-white"}`} data-panel="chassis">
          {chassis.label}
        </button>
      ) : null}
    </div>
  );
}
