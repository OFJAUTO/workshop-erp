"use client";

import { CAR_PANELS, OUTLINE_LABELS, OUTLINE_VIEWBOX, type PanelShape, type PanelTone } from "@/lib/car-outline";

const FILL: Record<PanelTone | "none", string> = { none: "#FFFFFF", amber: "#FCE9C2", red: "#F6D1CE" };
const STROKE: Record<PanelTone | "none", string> = { none: "#A1A1AA", amber: "#B7791F", red: "#B3261E" };
const [, , VB_W, VB_H] = OUTLINE_VIEWBOX.split(" ").map(Number);

function Shape({ s, fill, stroke, width, onClick, label, hook }: { s: PanelShape; fill: string; stroke: string; width: number; onClick?: () => void; label: string; hook: string }) {
  const common = { fill, stroke, strokeWidth: width, onClick, style: onClick ? { cursor: "pointer" } : undefined, "data-panel": hook, role: onClick ? "button" : undefined, "aria-label": label } as const;
  if (s.kind === "rect") return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r ?? 0} {...common}><title>{label}</title></rect>;
  if (s.kind === "circle") return <circle cx={s.cx} cy={s.cy} r={s.r} {...common}><title>{label}</title></circle>;
  return <path d={s.d} {...common}><title>{label}</title></path>;
}

/**
 * THE car outline (front at the top, FRONT / REAR / LEFT / RIGHT printed around it; left and right are the car's own,
 * as if sitting in the driver's seat): tap a panel to pick it. Marked panels are amber (minor) or red (moderate,
 * severe); the picked one has a black outline. One component for the gate-in damage, the customer's approval page,
 * the inspection's bodyshop findings and the bodyshop pre-work check; read-only when no onPick is given.
 */
export function CarOutline({ tones, selected = null, onPick, size = 220, showChassis = true }: { tones: Record<string, PanelTone | null | undefined>; selected?: string | null; onPick?: (panel: string) => void; size?: number; showChassis?: boolean }) {
  const chassis = CAR_PANELS.find((p) => p.key === "chassis")!;
  const chassisTone = tones.chassis ?? null;
  return (
    <div className="flex flex-col items-center gap-2" data-car-outline>
      <svg viewBox={OUTLINE_VIEWBOX} width={size} height={Math.round((size * VB_H) / VB_W)} className="max-w-full" role="img" aria-label="Car outline seen from above: front at the top, the car's right on the right">
        {OUTLINE_LABELS.map((l) => (
          <text key={l.text} x={l.x} y={l.y} transform={l.rotate ? `rotate(${l.rotate} ${l.x} ${l.y})` : undefined} textAnchor="middle" dominantBaseline="middle" fontSize="15" fontWeight="800" letterSpacing="2" fill="#111113" data-outline-label={l.text}>
            {l.text}
          </text>
        ))}
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
      {onPick ? <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Tap a panel</span> : null}
      {showChassis ? (
        <button type="button" disabled={!onPick} onClick={() => onPick?.("chassis")} aria-pressed={selected === "chassis"} className={`min-h-11 rounded-control border-2 px-4 text-sm font-bold ${selected === "chassis" ? "border-ink" : chassisTone === "red" ? "border-red-bar" : chassisTone === "amber" ? "border-amber-bar" : "border-line-strong"} ${chassisTone === "red" ? "bg-red-soft" : chassisTone === "amber" ? "bg-amber-soft" : "bg-white"}`} data-panel="chassis">
          {chassis.label}
        </button>
      ) : null}
    </div>
  );
}
