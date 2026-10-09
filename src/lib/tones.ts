/**
 * The notification sounds, made on the spot in the browser (no sound files). Four soft tones the
 * owner can choose in Settings; each person can pick their own from the bell. "remind" plays the
 * first note of the chosen tone, quietly.
 */
export const TONES = [
  { id: "marimba", label: "Soft marimba" },
  { id: "bell", label: "Low two-note bell" },
  { id: "pop", label: "Gentle pop" },
  { id: "chord", label: "Short warm chord" },
] as const;
export type ToneId = (typeof TONES)[number]["id"];
export const isTone = (v: unknown): v is ToneId => TONES.some((t) => t.id === v);

let audio: AudioContext | null = null;
/** One sound engine for the page. Browsers keep it muted until the person has clicked somewhere once. */
export function engine(): AudioContext | null {
  try {
    if (!audio) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio = new Ctx();
    }
    return audio;
  } catch {
    return null;
  }
}

type Note = { freq: number; at: number; len: number; type: OscillatorType; gain: number; harmonics?: number[] };

function notesOf(tone: ToneId): Note[] {
  switch (tone) {
    case "marimba":
      // Two soft wooden notes, quick decay.
      return [
        { freq: 659, at: 0, len: 0.35, type: "sine", gain: 1, harmonics: [2.4, 0.15] },
        { freq: 784, at: 0.22, len: 0.45, type: "sine", gain: 0.9, harmonics: [2.4, 0.15] },
      ];
    case "bell":
      // Two low notes with a soft ring.
      return [
        { freq: 440, at: 0, len: 0.9, type: "sine", gain: 0.9, harmonics: [2, 0.25, 3, 0.1] },
        { freq: 349, at: 0.45, len: 1.1, type: "sine", gain: 0.8, harmonics: [2, 0.25, 3, 0.1] },
      ];
    case "pop":
      return [{ freq: 520, at: 0, len: 0.12, type: "sine", gain: 1 }];
    case "chord":
    default:
      // C, E, G together, warm and short.
      return [
        { freq: 262, at: 0, len: 0.7, type: "triangle", gain: 0.7 },
        { freq: 330, at: 0.02, len: 0.7, type: "triangle", gain: 0.6 },
        { freq: 392, at: 0.04, len: 0.7, type: "triangle", gain: 0.6 },
      ];
  }
}

/** Plays a tone at a level between 0 and 1. "ok", or "blocked" while the browser still needs a click. */
export function playTone(tone: ToneId, level: number, opts: { remind?: boolean } = {}): "ok" | "blocked" | "none" {
  if (level <= 0) return "none";
  const ctx = engine();
  if (!ctx) return "none";
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
    if (ctx.state === "suspended") return "blocked";
  }
  const notes = opts.remind ? notesOf(tone).slice(0, 1) : notesOf(tone);
  const base = ctx.currentTime + 0.01;
  const scale = opts.remind ? 0.4 : 1;
  for (const n of notes) {
    const t = base + n.at;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, t);
    master.gain.linearRampToValueAtTime(level * n.gain * scale * 0.5, t + 0.012);
    master.gain.exponentialRampToValueAtTime(0.0008, t + n.len);
    master.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = n.type;
    osc.frequency.value = n.freq;
    if (tone === "pop") osc.frequency.exponentialRampToValueAtTime(n.freq * 0.6, t + n.len);
    osc.connect(master);
    osc.start(t);
    osc.stop(t + n.len + 0.05);
    const h = n.harmonics ?? [];
    for (let i = 0; i < h.length; i += 2) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = n.freq * h[i];
      g.gain.setValueAtTime(h[i + 1], t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + n.len * 0.6);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + n.len);
    }
  }
  return "ok";
}
