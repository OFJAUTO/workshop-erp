import "server-only";
import { notifyRoles } from "./notifications";
import { round2 } from "./money";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";

/**
 * Bodyshop materials by the roll (20 October 2026). Film (PPF): a roll has a price and a length, so a
 * metre has a cost; the PPF team leader enters the metres used per car at the end of his stage. Tint:
 * by the roll, not metres - each car taps which tint roll it used; the cost per car is estimated at a
 * tenth of the roll until the roll is finished, then the real price splits equally over the cars that
 * used it. Finishing a film roll compares the metres entered with the roll length (waste allowance from
 * Settings); a bigger gap tells the owner. Everything here is internal: the customer never sees it.
 */

export type FilmType = { key: string; name: string; roll_price: number; roll_m: number; costPerM: number };

export function filmTypesOf(settings: Settings): FilmType[] {
  const raw = (settings.film_types ?? []) as { key?: string; name?: string; roll_price?: number | string; roll_m?: number | string }[];
  return raw
    .map((t) => {
      const price = Number(t.roll_price) || 0;
      const m = Number(t.roll_m) || 0;
      return { key: String(t.key ?? "").trim() || String(t.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_"), name: String(t.name ?? "").trim(), roll_price: price, roll_m: m, costPerM: m > 0 ? round2(price / m) : 0 };
    })
    .filter((t) => t.name);
}

export type RollRow = {
  id: string;
  kind: "film" | "tint";
  film_key: string | null;
  name: string;
  length_m: number | null;
  price_aed: number;
  opened_at: string;
  finished_at: string | null;
  usedMetres: number;
  usedJobs: number;
  metresLeft: number | null;
};

export async function rollsWithUse(kind?: "film" | "tint"): Promise<RollRow[]> {
  const admin = createAdminClient();
  let q = admin.from("film_rolls").select("id, kind, film_key, name, length_m, price_aed, opened_at, finished_at").eq("is_active", true).order("opened_at", { ascending: false });
  if (kind) q = q.eq("kind", kind);
  const { data: rolls } = await q;
  const ids = (rolls ?? []).map((r) => r.id as string);
  const { data: uses } = ids.length ? await admin.from("film_usage").select("roll_id, metres, job_id").eq("is_active", true).in("roll_id", ids) : { data: [] };
  return ((rolls ?? []) as Record<string, unknown>[]).map((r) => {
    const mine = (uses ?? []).filter((u) => u.roll_id === r.id);
    const used = round2(mine.reduce((a, u) => a + (Number(u.metres) || 0), 0));
    const len = r.length_m === null ? null : Number(r.length_m);
    return {
      id: r.id as string,
      kind: r.kind as "film" | "tint",
      film_key: (r.film_key as string | null) ?? null,
      name: String(r.name),
      length_m: len,
      price_aed: Number(r.price_aed) || 0,
      opened_at: String(r.opened_at),
      finished_at: (r.finished_at as string | null) ?? null,
      usedMetres: used,
      usedJobs: new Set(mine.map((u) => u.job_id)).size,
      metresLeft: len === null ? null : round2(len - used),
    };
  });
}

/** Opening a roll registers it: the price and length come from Settings at that moment. */
export async function openRoll(input: { kind: "film" | "tint"; filmKey: string | null; name: string }, settings: Settings, by: string): Promise<{ error?: string; id?: string }> {
  const admin = createAdminClient();
  let price = 0;
  let length: number | null = null;
  if (input.kind === "film") {
    const t = filmTypesOf(settings).find((x) => x.key === input.filmKey);
    if (!t) return { error: "Pick the film type." };
    price = t.roll_price;
    length = t.roll_m;
  } else {
    price = Number(settings.tint_roll_price_aed) || 0;
  }
  const { data, error } = await admin.from("film_rolls").insert({ kind: input.kind, film_key: input.filmKey, name: input.name.trim() || "Roll", length_m: length, price_aed: price, created_by: by, updated_by: by }).select("id").single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

/** The PPF leader's metres for one car: cost = metres × the roll's cost per metre. */
export async function recordFilmUsage(jobId: string, rollId: string, metres: number, photoPath: string | null, by: string): Promise<{ error?: string; cost?: number }> {
  const admin = createAdminClient();
  const { data: roll } = await admin.from("film_rolls").select("id, kind, price_aed, length_m, finished_at").eq("id", rollId).maybeSingle();
  if (!roll || roll.kind !== "film") return { error: "Roll not found." };
  if (roll.finished_at) return { error: "That roll is finished: open or pick another." };
  if (!(metres > 0) || metres > 200) return { error: "Enter the metres used (0 to 200)." };
  const perM = Number(roll.length_m) > 0 ? Number(roll.price_aed) / Number(roll.length_m) : 0;
  const cost = round2(metres * perM);
  const { error } = await admin.from("film_usage").insert({ job_id: jobId, roll_id: rollId, metres, cost_aed: cost, photo_path: photoPath, created_by: by, updated_by: by });
  if (error) return { error: error.message };
  return { cost };
}

/** One tap: this car used this tint roll. Estimated at a tenth of the roll until the roll is finished. */
export async function recordTintUsage(jobId: string, rollId: string, by: string): Promise<{ error?: string; cost?: number }> {
  const admin = createAdminClient();
  const { data: roll } = await admin.from("film_rolls").select("id, kind, price_aed, finished_at").eq("id", rollId).maybeSingle();
  if (!roll || roll.kind !== "tint") return { error: "Tint roll not found." };
  if (roll.finished_at) return { error: "That roll is finished: open or pick another." };
  const { data: already } = await admin.from("film_usage").select("id").eq("job_id", jobId).eq("roll_id", rollId).eq("is_active", true).limit(1);
  if (already?.length) return { error: "This car is already on that roll." };
  const cost = round2((Number(roll.price_aed) || 0) / 10);
  const { error } = await admin.from("film_usage").insert({ job_id: jobId, roll_id: rollId, metres: null, cost_aed: cost, created_by: by, updated_by: by });
  if (error) return { error: error.message };
  return { cost };
}

/**
 * Roll finished. Film: metres entered vs the roll length, allowing the waste percentage - a bigger gap
 * is flagged to the owner. Tint: the roll's real price splits equally over the cars that used it and
 * every car's estimate is corrected.
 */
export async function finishRoll(rollId: string, settings: Settings, actor: { id: string; display_name: string }): Promise<{ error?: string; message?: string }> {
  const admin = createAdminClient();
  const { data: roll } = await admin.from("film_rolls").select("id, kind, name, price_aed, length_m, finished_at").eq("id", rollId).maybeSingle();
  if (!roll) return { error: "Roll not found." };
  if (roll.finished_at) return { error: "Already finished." };
  const { data: uses } = await admin.from("film_usage").select("id, job_id, metres, cost_aed").eq("roll_id", rollId).eq("is_active", true);
  const now = new Date().toISOString();
  if (roll.kind === "film") {
    const used = round2((uses ?? []).reduce((a, u) => a + (Number(u.metres) || 0), 0));
    const length = Number(roll.length_m) || 0;
    const allowance = (Number(settings.bodyshop_waste_percent) || 10) / 100;
    const gap = round2(length - used);
    const over = length > 0 && gap > length * allowance;
    const note = `${used} m entered of ${length} m${gap >= 0 ? `, ${gap} m unaccounted` : `, ${Math.abs(gap)} m over`}`;
    await admin.from("film_rolls").update({ finished_at: now, finished_by: actor.id, waste_note: note, updated_by: actor.id }).eq("id", rollId);
    if (over) await notifyRoles(["owner"], { type: "film_waste", title: `Film roll ${roll.name}: ${gap} m unaccounted`, body: `${note}. The waste allowance is ${Math.round(allowance * 100)}%.`, href: "/bodyshop/rolls" });
    return { message: `Roll finished: ${note}.` };
  }
  // Tint: the real split corrects every car that used the roll.
  const cars = uses ?? [];
  if (cars.length) {
    const each = round2((Number(roll.price_aed) || 0) / cars.length);
    for (const u of cars) await admin.from("film_usage").update({ cost_aed: each, corrected: true, updated_by: actor.id }).eq("id", u.id);
  }
  await admin.from("film_rolls").update({ finished_at: now, finished_by: actor.id, waste_note: `${cars.length} car${cars.length === 1 ? "" : "s"} on this roll`, updated_by: actor.id }).eq("id", rollId);
  return { message: `Roll finished: the real price split over ${cars.length} car${cars.length === 1 ? "" : "s"}.` };
}

/** The film and tint cost on one job. */
export async function jobFilmCost(jobId: string): Promise<{ film: number; tint: number; metres: number; ceramic: number }> {
  const admin = createAdminClient();
  const [{ data }, { data: cer }] = await Promise.all([
    admin.from("film_usage").select("metres, cost_aed, roll:film_rolls(kind)").eq("job_id", jobId).eq("is_active", true),
    admin.from("ceramic_usage").select("cost_aed").eq("job_id", jobId).eq("is_active", true),
  ]);
  const ceramic = round2((cer ?? []).reduce((a, c) => a + (Number(c.cost_aed) || 0), 0));
  let film = 0;
  let tint = 0;
  let metres = 0;
  for (const u of data ?? []) {
    const kind = (u.roll as unknown as { kind: string } | null)?.kind;
    if (kind === "tint") tint += Number(u.cost_aed) || 0;
    else {
      film += Number(u.cost_aed) || 0;
      metres += Number(u.metres) || 0;
    }
  }
  return { film: round2(film), tint: round2(tint), metres: round2(metres), ceramic };
}

/** The consumables share per bodyshop car: the monthly amount over the cars finished that month (last month's average until month end). */
export async function consumablesShare(settings: Settings, now = new Date()): Promise<number> {
  const monthly = Number(settings.bodyshop_consumables_monthly_aed) || 0;
  if (!monthly) return 0;
  const admin = createAdminClient();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count } = await admin.from("jobs").select("id", { count: "exact", head: true }).eq("department", "bodyshop").gte("gated_out_at", start).lt("gated_out_at", end);
  return round2(monthly / Math.max(1, count ?? 0));
}

/** Ceramic on a car (B2): one row per coat, the share of a bottle (Settings: cars per bottle) at the bottle price. */
export async function recordCeramicUsage(jobId: string, input: { kind: "exterior" | "interior"; product: string | null; batch: string | null }, settings: Settings, by: string): Promise<{ error?: string; cost?: number }> {
  const perBottle = Number(input.kind === "exterior" ? settings.ceramic_cars_exterior_per_bottle : settings.ceramic_cars_interior_per_bottle) || (input.kind === "exterior" ? 4 : 5.5);
  const share = Math.round((1 / perBottle) * 1000) / 1000;
  const cost = round2((Number(settings.ceramic_bottle_price_aed) || 300) * share);
  const { error } = await createAdminClient().from("ceramic_usage").insert({ job_id: jobId, kind: input.kind, product: input.product?.slice(0, 120) ?? null, batch: input.batch?.slice(0, 60) ?? null, share, cost_aed: cost, created_by: by, updated_by: by });
  return error ? { error: "Couldn't save the ceramic. Try again." } : { cost };
}

/** The ceramic recorded on a car. */
export async function jobCeramicUsage(jobId: string): Promise<{ id: string; kind: string; product: string | null; batch: string | null; cost: number; at: string }[]> {
  const { data } = await createAdminClient().from("ceramic_usage").select("id, kind, product, batch, cost_aed, created_at").eq("job_id", jobId).eq("is_active", true).order("created_at");
  return ((data ?? []) as { id: string; kind: string; product: string | null; batch: string | null; cost_aed: number | string; created_at: string }[]).map((r) => ({ id: r.id, kind: r.kind, product: r.product, batch: r.batch, cost: Number(r.cost_aed) || 0, at: r.created_at }));
}
