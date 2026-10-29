// THE layout rules, measured inside the real browser on one page (29 October 2026, batch section 2):
//  - the page never scrolls sideways (wide tables scroll inside their own box);
//  - nothing interactive overlaps another control or is cut off at the right edge;
//  - no text sits on top of other text;
//  - no text is clipped by a box that hides its overflow (a deliberate "…" is allowed);
//  - no word is broken in the middle, no code or date is split ("J-" / "00016") and no one- or two-letter piece is
//    left at a hyphen ("G-" / "Class"); a compound word may wrap at its own hyphen, and a break after "/" is allowed;
//  - nothing sticks out of its card;
//  - on a touch screen every button, picker and box is at least 40 px tall (44 px by design, 4 px slack for borders).
// Used by layout-check.mjs for every staff and customer page.

/** In the browser. Returns up to `limit` problem lines. */
export function measurePage({ touch = false, limit = 20 } = {}) {
  const problems = [];
  const W = window.innerWidth;
  const doc = document.documentElement;
  if (doc.scrollWidth > W + 1) problems.push(`horizontal scroll (page ${doc.scrollWidth}px in a ${W}px window)`);

  const hiddenByDetails = (el) => {
    for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) {
      if (!d.open && !(el.closest("summary") && d.contains(el.closest("summary")))) return true;
    }
    return false;
  };
  const visibleStyle = (el) => {
    const cs = getComputedStyle(el);
    return !(cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0);
  };
  const ignored = (el) => !!(el.closest("[aria-hidden='true']") || el.closest("[data-overlap-ok]") || el.closest("dialog") || el.closest("[data-layout-skip]"));
  const isSrOnly = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position === "absolute" && (cs.clip === "rect(0px, 0px, 0px, 0px)" || cs.clipPath === "inset(50%)") ) return true;
      if (n.classList?.contains("sr-only")) return true;
    }
    return false;
  };
  // Out of view inside a sideways-scrolling strip: not on screen, so not judged.
  const outOfStrip = (el, r) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) {
        const nr = n.getBoundingClientRect();
        if (r.right <= nr.left + 1 || r.left >= nr.right - 1) return true;
      }
    }
    return false;
  };
  const inSidewaysScroller = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1 && n.getBoundingClientRect().right <= W + 1) return true;
    }
    return false;
  };
  const inBottomBar = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === "fixed" || p === "sticky") return n.getBoundingClientRect().top > window.innerHeight * 0.55 ? "bottom" : "top";
    }
    return "";
  };
  const label = (el) => `${el.tagName.toLowerCase()} "${((el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ")).slice(0, 40)}"`;
  // What is actually on screen of a box: cut down by every ancestor that hides or scrolls its overflow
  // (a deliberate "…" truncation hides the rest of its text; that hidden part overlaps nothing).
  const shown = (el, r) => {
    let x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const cx = /(hidden|clip|auto|scroll)/.test(cs.overflowX);
      const cy = /(hidden|clip|auto|scroll)/.test(cs.overflowY);
      if (!cx && !cy) continue;
      const nr = n.getBoundingClientRect();
      if (cx) { x1 = Math.max(x1, nr.left); x2 = Math.min(x2, nr.right); }
      if (cy) { y1 = Math.max(y1, nr.top); y2 = Math.min(y2, nr.bottom); }
    }
    return { left: x1, top: y1, right: x2, bottom: y2, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
  };

  /* ---- 1. Controls: overlap, cut off at the right edge, too small for a finger ---- */
  const controls = [...document.querySelectorAll("button, a[href], input, select, textarea, [role='button']")].filter((el) => {
    if (ignored(el) || hiddenByDetails(el) || !visibleStyle(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    return !outOfStrip(el, r);
  });
  const rects = controls.map((el) => ({ el, r: el.getBoundingClientRect() }));
  for (const { el, r } of rects) {
    if (r.right > W + 1 && r.left < W - 4 && !inSidewaysScroller(el)) problems.push(`cut off at the right edge: ${label(el)}`);
    if (touch) {
      const t = el.tagName;
      const type = (el.getAttribute("type") || "").toLowerCase();
      const isBox = t === "SELECT" || t === "TEXTAREA" || (t === "INPUT" && !["checkbox", "radio", "hidden", "range", "file", "color"].includes(type));
      const isButton = t === "BUTTON" || el.getAttribute("role") === "button" || (t === "A" && /(^|\s)(inline-flex|flex)(\s|$)/.test(el.className) && /min-h-|h-1[0-9]|h-9|rounded/.test(el.className));
      if ((isBox || isButton) && r.height < 40 && !el.closest("[data-small-ok]") && !el.closest("table") && !isSrOnly(el)) problems.push(`too small for a finger (${Math.round(r.height)}px tall): ${label(el)}`);
    }
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox > 4 && oy > 4 && inBottomBar(a.el) === inBottomBar(b.el)) problems.push(`overlap: ${label(a.el)} ON ${label(b.el)} (${Math.round(ox)}×${Math.round(oy)}px)`);
    }
  }

  /* ---- 2. Text: line boxes of every visible text node ---- */
  const lines = [];
  const words = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const el = node.parentElement;
      if (!el || ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION", "TITLE"].includes(el.tagName)) return NodeFilter.FILTER_REJECT;
      if (ignored(el) || hiddenByDetails(el) || !visibleStyle(el) || isSrOnly(el)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const range = document.createRange();
  for (let node = walker.nextNode(); node && lines.length < 6000; node = walker.nextNode()) {
    const el = node.parentElement;
    range.selectNodeContents(node);
    for (const raw of range.getClientRects()) {
      if (raw.width < 2 || raw.height < 2) continue;
      if (outOfStrip(el, raw)) continue;
      const r = shown(el, raw);
      if (r.width < 2 || r.height < 2) continue;
      lines.push({ el, r, raw, text: node.nodeValue.trim().slice(0, 30) });
    }
    // Words broken across two lines: each whitespace or slash separated piece must sit on one line. A compound word
    // may wrap at its own hyphen as English text does ("one-" / "way"), but never inside a piece, never inside a code,
    // number or date ("J-" / "00016", "2026-" / "10-27") and never leaving a piece of one or two letters ("G-" / "Class").
    const text = node.nodeValue;
    const re = /[^\s/]{3,}/g;
    const linesOf = (from, to) => {
      range.setStart(node, from);
      range.setEnd(node, to);
      return new Set([...range.getClientRects()].filter((x) => x.width > 0.5).map((x) => Math.round(x.top / 4)));
    };
    let m;
    while ((m = re.exec(text)) && words.length < 20000) {
      if (linesOf(m.index, m.index + m[0].length).size <= 1) continue;
      const pieces = m[0].split("-");
      let at = m.index;
      let bad = /\d/.test(m[0]) || pieces.length === 1;
      for (let k = 0; k < pieces.length && !bad; k++) {
        const p = pieces[k];
        if (p && linesOf(at, at + p.length).size > 1) bad = true;
        if (k < pieces.length - 1 && !bad) {
          const next = pieces[k + 1];
          const broken = p && next && linesOf(at, at + p.length + 1 + next.length).size > 1;
          if (broken && (p.replace(/\W/g, "").length < 3 || next.replace(/\W/g, "").length < 3)) bad = true;
        }
        at += p.length + 1;
      }
      if (bad) words.push({ el, word: m[0] });
    }
  }
  for (const w of words.slice(0, 6)) problems.push(`word broken across two lines: "${w.word}" in ${label(w.el.closest("button, a, li, td, div, span, p") ?? w.el)}`);

  // Text on top of other text (different elements, neither inside the other).
  lines.sort((a, b) => a.r.top - b.r.top);
  let overlapCount = 0;
  for (let i = 0; i < lines.length && overlapCount < 6; i++) {
    const a = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j];
      if (b.r.top >= a.r.bottom - 2) break;
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox > 3 && oy > 3 && inBottomBar(a.el) === inBottomBar(b.el)) {
        problems.push(`text on top of text: "${a.text}" / "${b.text}"`);
        overlapCount++;
        break;
      }
    }
  }

  // Text clipped by a box that hides its overflow (a deliberate "…" truncation is allowed).
  let clipCount = 0;
  for (const { el, raw: r, text } of lines) {
    if (clipCount >= 6) break;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const hx = /(hidden|clip)/.test(cs.overflowX);
      const hy = /(hidden|clip)/.test(cs.overflowY);
      if (!hx && !hy) continue;
      if (cs.textOverflow === "ellipsis" || getComputedStyle(el).textOverflow === "ellipsis" || cs.webkitLineClamp !== "none" && cs.webkitLineClamp) break;
      const nr = n.getBoundingClientRect();
      const outX = hx && (r.right > nr.right + 2 || r.left < nr.left - 2);
      const outY = hy && (r.bottom > nr.bottom + 2 || r.top < nr.top - 2);
      if (outX || outY) {
        problems.push(`text cut off by its box: "${text}"`);
        clipCount++;
      }
      break;
    }
  }

  /* ---- 3. Nothing sticks out of its card ---- */
  const cards = [...document.querySelectorAll(".rounded-card, [data-car-card]")].filter((c) => {
    if (ignored(c) || hiddenByDetails(c) || !visibleStyle(c)) return false;
    const cs = getComputedStyle(c);
    return parseFloat(cs.borderLeftWidth) > 0 || (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent");
  });
  let outCount = 0;
  for (const card of cards) {
    if (outCount >= 6) break;
    const cr = card.getBoundingClientRect();
    if (cr.width < 40) continue;
    for (const child of card.querySelectorAll("*")) {
      if (ignored(child) || hiddenByDetails(child) || !visibleStyle(child) || isSrOnly(child)) continue;
      const cs = getComputedStyle(child);
      if (cs.position === "fixed") continue;
      const whole = child.getBoundingClientRect();
      if (whole.width < 2 || whole.height < 2 || outOfStrip(child, whole)) continue;
      const r = shown(child, whole);
      if (r.width < 2 || r.height < 2) continue;
      if (r.right > cr.right + 2 || r.left < cr.left - 2) {
        problems.push(`sticks out of its card: ${label(child)} (${Math.round(Math.max(r.right - cr.right, cr.left - r.left))}px)`);
        outCount++;
        break;
      }
    }
  }
  return [...new Set(problems)].slice(0, limit);
}
