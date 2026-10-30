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
  /** Section 11: the tint specification's share of a car (sides & rear = 1; windshield and roof a third each; double layer doubles a window). */
  tintFactor?: number;
  /** Section 11: the extra installer hours for the double-layer windows. */
  tintExtraHours?: number;
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
  const tintFactor = i.tintFactor && i.tintFactor > 0 ? i.tintFactor : 1;
  const tint = wantsTint ? r2(i.tintPerCar * tintFactor) : 0;
  const ceramic = r2((ceramicExt ? i.ceramicExteriorPerCar : 0) + (ceramicInt ? i.ceramicInteriorPerCar : 0));
  const consumables = r2(i.consumablesPerCar);
  const hours = r2(i.hours + (wantsTint ? (i.tintExtraHours ?? 0) : 0));
  const labour = { hours, aed: r2(hours * i.ratePerHour) };
  const recovery = r2(i.recoveryCost);
  const total = r2((film?.aed ?? 0) + tint + ceramic + consumables + labour.aed + recovery);
  const profit = r2(i.packagePrice - total);
  const percent = i.packagePrice > 0 ? Math.round((profit / i.packagePrice) * 100) : 0;
  const parts = [
    film ? `film ${film.rolls} roll${film.rolls === 1 ? "" : "s"}${film.matte ? " (matte)" : ""} ${aed(film.aed)}` : null,
    tint ? `tint ${aed(tint)}${tintFactor !== 1 ? ` (${tintFactor} × a car)` : ""}` : null,
    ceramic ? `ceramic ${aed(ceramic)}` : null,
    consumables ? `consumables ${aed(consumables)}` : null,
    `labour ${labour.hours} h${wantsTint && i.tintExtraHours ? ` (incl. ${i.tintExtraHours} h double layer)` : ""} ${aed(labour.aed)}`,
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

/* ---------------------------------------------------------------------------------------------------------------
   ONE profit calculation (30 October 2026, night batch section 3): the quotation's totals (quoteTotals) cost every
   package line with these figures, so the internal box, the bottom bar, the job card, the profit page, the daily
   target and the reports all read the same film, tint, ceramic, consumables and installer hours. Pure.
   --------------------------------------------------------------------------------------------------------------- */

/** The figures a package is costed with (Settings, the car, the quotation's film rolls and tint specification). */
export type PackageCosting = {
  filmRollPriceGloss: number;
  filmRollPriceMatte: number;
  tintPerCar: number;
  /** The tint specification's share of a car (the windows included; 1 = sides & rear). */
  tintFactor: number;
  /** Extra installer hours for double-layer windows. */
  tintExtraHours: number;
  ceramicExteriorPerCar: number;
  ceramicInteriorPerCar: number;
  consumablesPerCar: number;
  /** Installer hours of a package when its line carries none (Settings, default 80). */
  packageHours: number;
  /** Bodyshop labour cost per hour (Settings, default 50). */
  ratePerHour: number;
  /** Film rolls for this car (section 3.3: past jobs on the model, else the car size; the advisor may raise it). */
  rolls: number;
};

export type PackageLineCost = { film: number; filmRolls: number; matte: boolean; tint: number; ceramic: number; consumables: number; hours: number; labour: number; total: number };

/** The package's included items still switched on (section 6.5: an item marked "Not needed" is costed at nothing). */
export function packageItemLabels(snapshot: unknown): string[] {
  const items = Array.isArray(snapshot) ? snapshot : snapshot && typeof snapshot === "object" && Array.isArray((snapshot as { items?: unknown }).items) ? (snapshot as { items: unknown[] }).items : [];
  return (items as { label?: unknown; off?: unknown }[]).filter((i) => i && !i.off).map((i) => String(i.label ?? "")).filter(Boolean);
}

/** One package line's internal costs: film (rolls × the finish's roll price), tint, ceramic, consumables and labour. */
export function packageLineCost(p: { title: string; itemLabels: string[]; installerHours: number | null }, c: PackageCosting): PackageLineCost {
  // The title names the package; what is in it decides the costs once the items are listed. Item by item: a tint item
  // ("ceramic heat rejection film" is window tint), a PPF item, and ceramic COATING split into exterior and interior.
  const labels = (p.itemLabels.length ? p.itemLabels : [p.title]).map((l) => l.toLowerCase());
  const isTint = (l: string) => /\btint\b|heat rejection|window film/.test(l);
  const isFilm = (l: string) => /\bppf\b|paint protection/.test(l) && !/remov/.test(l) && !isTint(l);
  const isCeramic = (l: string) => /ceramic/.test(l) && !isTint(l);
  const wantsFilm = labels.some(isFilm);
  const matte = [p.title, ...p.itemLabels].some((l) => /\bmatte?\b|\bstealth\b/i.test(l));
  const wantsTint = labels.some(isTint);
  const ceramicInt = labels.some((l) => isCeramic(l) && /(interior|leather|fabric|upholstery)/.test(l));
  const ceramicExt = labels.some((l) => isCeramic(l) && !/(interior|leather|fabric|upholstery)/.test(l));
  const filmRolls = wantsFilm ? Math.max(0, c.rolls) : 0;
  const film = wantsFilm ? r2(filmRolls * (matte ? c.filmRollPriceMatte : c.filmRollPriceGloss)) : 0;
  const tint = wantsTint ? r2(c.tintPerCar * (c.tintFactor > 0 ? c.tintFactor : 0)) : 0;
  const ceramic = r2((ceramicExt ? c.ceramicExteriorPerCar : 0) + (ceramicInt ? c.ceramicInteriorPerCar : 0));
  const consumables = r2(c.consumablesPerCar);
  const hours = r2((p.installerHours ?? c.packageHours) + (wantsTint ? c.tintExtraHours : 0));
  const labour = r2(hours * c.ratePerHour);
  return { film, filmRolls, matte, tint, ceramic, consumables, hours, labour, total: r2(film + tint + ceramic + consumables + labour) };
}

/** The costing as the server builds it (Settings and the car), before the film rolls are chosen. */
export type PackageCostingBase = Omit<PackageCosting, "rolls"> & {
  bigCar: boolean;
  bigRolls: number;
  /** The rolls typed on the quotation, when any. */
  rollsEst: number | null;
  /** Section 3.3: the default - the most used on the same model before, else the car's size, else 1. */
  defaultRolls: number;
  /** Why that default ("the most used on a G 63 before: 1.6 rolls (J-00412)"). */
  rollsWhy: string;
};

/** The costing with its film rolls: the quotation's own figure, else the default. */
export function costingWithRolls(c: PackageCostingBase, rollsEst?: number | null): PackageCosting {
  const typed = rollsEst ?? c.rollsEst;
  return { ...c, rolls: typed !== null && typed !== undefined && Number.isFinite(typed) && typed > 0 ? typed : c.defaultRolls };
}

/**
 * Film on a PPF line that is not a package (a mirror housing, a bumper): its share of a whole car's film, by its
 * installer hours against a whole car's (30 October 2026, night batch section 5.3: a complimentary PPF job never shows
 * materials of 0). One hour of an 80-hour car at 1 roll of AED 1,429 is AED 17.86.
 */
export function plainPpfFilm(l: { hours?: number | null; installer_hours?: number | null; hours_estimate?: number | null; title?: string | null }, c: PackageCosting): number {
  const hours = Number(l.installer_hours) || Number(l.hours_estimate) || Number(l.hours) || 1;
  const share = Math.min(1, hours / Math.max(1, c.packageHours || 80));
  const matte = /\bmatte?\b|\bstealth\b/i.test(l.title ?? "");
  return r2(share * Math.max(0.1, c.rolls || 1) * (matte ? c.filmRollPriceMatte : c.filmRollPriceGloss));
}
