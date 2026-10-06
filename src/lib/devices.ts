import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "./supabase/admin";
import type { DeviceRow } from "./types";

export const DEVICE_COOKIE = "erp_device";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function hashDeviceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newDeviceToken() {
  return randomBytes(32).toString("hex");
}

export function deviceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  };
}

/** The registered tablet this request comes from, or null. */
export async function getCurrentDevice(): Promise<DeviceRow | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(DEVICE_COOKIE)?.value;
  if (!token) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("devices")
    .select("id, name, location, is_active, registered_at, registered_by, last_seen_at, last_staff_id")
    .eq("token_hash", hashDeviceToken(token))
    .eq("is_active", true)
    .maybeSingle();

  return (data as DeviceRow | null) ?? null;
}
