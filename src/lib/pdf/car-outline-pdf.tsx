import { Circle, Path, Rect, Svg } from "@react-pdf/renderer";
import { CAR_PANELS, type PanelTone } from "../car-outline";

const FILL: Record<PanelTone | "none", string> = { none: "#FFFFFF", amber: "#FCE9C2", red: "#F6D1CE" };
const STROKE: Record<PanelTone | "none", string> = { none: "#A1A1AA", amber: "#B7791F", red: "#B3261E" };

/** The car outline in a PDF (the same panels and colours as on screen): damaged panels amber or red. */
export function CarOutlinePdf({ tones, width = 120 }: { tones: Record<string, PanelTone | null | undefined>; width?: number }) {
  return (
    <Svg viewBox="0 0 240 480" width={width} height={width * 2}>
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
