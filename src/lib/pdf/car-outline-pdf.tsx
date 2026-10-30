import { Circle, G, Path, Rect, Svg, Text } from "@react-pdf/renderer";
import { CAR_PANELS, OUTLINE_LABELS, OUTLINE_VIEWBOX, type PanelTone } from "../car-outline";

const FILL: Record<PanelTone | "none", string> = { none: "#FFFFFF", amber: "#FCE9C2", red: "#F6D1CE" };
const STROKE: Record<PanelTone | "none", string> = { none: "#A1A1AA", amber: "#B7791F", red: "#B3261E" };
const [, , VB_W, VB_H] = OUTLINE_VIEWBOX.split(" ").map(Number);

/** THE car outline in a PDF (the same panels, colours and FRONT / REAR / LEFT / RIGHT as on screen). */
export function CarOutlinePdf({ tones, width = 120 }: { tones: Record<string, PanelTone | null | undefined>; width?: number }) {
  return (
    <Svg viewBox={OUTLINE_VIEWBOX} width={width} height={(width * VB_H) / VB_W}>
      {OUTLINE_LABELS.map((l) => (
        <G key={l.text} transform={l.rotate ? `rotate(${l.rotate} ${l.x} ${l.y})` : undefined}>
          <Text x={l.x} y={l.y + 5} textAnchor="middle" style={{ fontSize: 15, fontWeight: 700 }} fill="#111113">{l.text}</Text>
        </G>
      ))}
      {CAR_PANELS.filter((p) => p.shape).map((p) => {
        const tone = tones[p.key] ?? "none";
        const s = p.shape!;
        const style = { fill: FILL[tone], stroke: STROKE[tone], strokeWidth: 1.5 };
        if (s.kind === "rect") return <Rect key={p.key} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r ?? 0} {...style} />;
        if (s.kind === "circle") return <Circle key={p.key} cx={s.cx} cy={s.cy} r={s.r} {...style} />;
        return <Path key={p.key} d={s.d} {...style} />;
      })}
    </Svg>
  );
}
