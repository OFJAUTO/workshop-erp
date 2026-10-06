import "server-only";
import { cache } from "react";
import { createAdminClient } from "./supabase/admin";

const DEFAULTS = {
  company_name: "Your workshop",
  company_trn: "",
  tablet_idle_lock_seconds: 120,
  pin_max_attempts: 5,
  pin_lock_minutes: 5,
  discount_limit_percent: 25,
  video_retention_months: 6,
  terms_and_conditions: "",
};

export type Settings = typeof DEFAULTS;

/** All settings, with safe defaults if a row is missing. Read with the master key so every screen can use them. */
export const getSettings = cache(async (): Promise<Settings> => {
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("key, value");
  const result: Record<string, unknown> = { ...DEFAULTS };
  for (const row of data ?? []) {
    if (row.key in DEFAULTS) result[row.key] = row.value;
  }
  return result as Settings;
});
