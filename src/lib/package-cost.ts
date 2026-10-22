/**
 * Section 7 (21 October 2026): a package's INTERNAL cost estimate, filled in by itself from Settings.
 * The advisor types only the package price; the grey box works out film (rolls × roll price, matte or
 * gloss, 1.5 rolls for the big cars), tint per car, ceramic per car (bottle ÷ cars), the month's
 * consumables share, installer labour (hours × the bodyshop rate) and the complimentary recovery - and
 * says the estimated profit. Pure: no imports, testable alone. Real figures replace these after the job.
 */

export type PackageCostInputs = {
  packagePrice: number;
  /** The package line's title plus its included items' labels, for detecting film, tint and ceramic. */
  title: string;
  itemLabels: string[];
  /** Film rolls to cost: the owner's per-job figure, else 1 (1.5 for a big car). */
  rolls: number;
  filmRollPriceGloss: number;
  filmRollPriceMatte: number;
  tintPerCar: number;
  ceramicExteriorPerCar: number;
  ceramicInteriorPerCar: number;
  consumablesPerCar: number;
  /** Installer hours: the line's own figure when typed, else the package default from Settings. */
  hours: number;
  ratePerHour: number;
  recoveryCost: number;
};

export type PackageCostEstimate = {
  film: { rolls: number; aed: number; matte: boolean } | null;
  tint: number;
  ceramic: number;
  consumables: number;
  labour: { hours: number; aed: number };
  recovery: number;
  total: number;
  profit: number;
  percent: number;
  /** The one line for the internal box: "film 1 roll AED 1,429 · tint AED 120 · …". */
  words: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

export function packageCostEstimate(i: PackageCostInputs): PackageCostEstimate {
  const text = [i.title, ...i.itemLabels].join(" · ").toLowerCase();
  const wantsFilm = /\bppf\b|paint protection/.test(text) && !/removal only/.test(text);
  const matte = /\bmatte?\b|\bstealth\b/.test(text);
  const wantsTint = /\btint\b/.test(text);
  const ceramicExt = /ceramic/.test(text);
  const ceramicInt = /(interior|leather)[^·]*ceramic|ceramic[^·]*(interior|leather)/.test(text);

  const film = wantsFilm ? { rolls: i.rolls, matte, aed: r2(i.rolls * (matte ? i.filmRollPriceMatte : i.filmRollPriceGloss)) } : null;
  const tint = wantsTint ? r2(i.tintPerCar) : 0;
  const ceramic = r2((ceramicExt ? i.ceramicExteriorPerCar : 0) + (ceramicInt ? i.ceramicInteriorPerCar : 0));
  const consumables = r2(i.consumablesPerCar);
  const labour = { hours: i.hours, aed: r2(i.hours * i.ratePerHour) };
  const recovery = r2(i.recoveryCost);
  const total = r2((film?.aed ?? 0) + tint + ceramic + consumables + labour.aed + recovery);
  const profit = r2(i.packagePrice - total);
  const percent = i.packagePrice > 0 ? Math.round((profit / i.packagePrice) * 100) : 0;
  const parts = [
    film ? `film ${film.rolls} roll${film.rolls === 1 ? "" : "s"}${film.matte ? " (matte)" : ""} ${aed(film.aed)}` : null,
    tint ? `tint ${aed(tint)}` : null,
    ceramic ? `ceramic ${aed(ceramic)}` : null,
    consumables ? `consumables ${aed(consumables)}` : null,
    `labour ${labour.hours} h ${aed(labour.aed)}`,
    recovery ? `recovery ${aed(recovery)}` : null,
  ].filter(Boolean);
  return { film, tint, ceramic, consumables, labour, recovery, total, profit, percent, words: `Estimated cost: ${parts.join(" · ")} → estimated profit ${aed(profit)} (${percent}%)` };
}

/** Whether the car counts as BIG for film (1.5 rolls): its model or title against the Settings list. */
export function isBigCar(carTitle: string | null | undefined, bigModels: string[]): boolean {
  const t = (carTitle ?? "").toLowerCase();
  if (!t) return false;
  return bigModels.some((m) => m && t.includes(m.toLowerCase()));
}
