"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Text on a sticker that always fits: the font shrinks (in mm, so the preview matches the print exactly) until
 * the whole text sits on one line; below the one-line minimum it wraps to two lines, still shrunk to fit. Never
 * an ellipsis. allowWrap={false} keeps it to one line whatever happens (the job number).
 */
export function FitText({ text, maxMm, minOneLineMm, minMm, lineHeight = 1.1, allowWrap = true, style }: { text: string; maxMm: number; minOneLineMm?: number; minMm?: number; lineHeight?: number; allowWrap?: boolean; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [fitted, setFitted] = useState<{ size: number; wrap: boolean }>({ size: maxMm, wrap: false });
  useLayoutEffect(() => {
    const el = ref.current;
    const inl = inner.current;
    if (!el || !inl) return;
    const oneMin = Math.min(minOneLineMm ?? maxMm * 0.8, maxMm);
    let s = maxMm;
    let wrap = false;
    el.style.whiteSpace = "nowrap";
    for (let i = 0; i < 30; i++) {
      el.style.fontSize = `${s}mm`;
      if (el.scrollWidth <= el.clientWidth + 1) break;
      if (s <= oneMin + 0.01) { wrap = allowWrap; break; }
      s = Math.max(oneMin, s - Math.max(0.08, s * 0.07));
    }
    if (wrap) {
      // Two lines mean two lines: the real line boxes are counted, shrinking until no more than two remain.
      const hardFloor = Math.min(oneMin, 0.9);
      el.style.whiteSpace = "normal";
      for (let i = 0; i < 40; i++) {
        el.style.fontSize = `${s}mm`;
        if (inl.getClientRects().length <= 2) break;
        if (s <= hardFloor + 0.01) break;
        s = Math.max(hardFloor, s - Math.max(0.06, s * 0.06));
      }
    }
    setFitted({ size: s, wrap });
  }, [text, maxMm, minOneLineMm, minMm, lineHeight, allowWrap]);
  return (
    <span ref={ref} data-fit-text style={{ display: "block", width: "100%", overflow: "hidden", whiteSpace: fitted.wrap ? "normal" : "nowrap", fontSize: `${fitted.size}mm`, lineHeight, ...style }}>
      <span ref={inner}>{text}</span>
    </span>
  );
}
