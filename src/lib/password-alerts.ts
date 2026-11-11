import "server-only";
import { headers } from "next/headers";
import { notifyStaff } from "./notifications";
import { ownerIds } from "./passkey-server";
import { NEW_DEVICE_TYPE, SUMMARY_HOUR, SUMMARY_TYPE, dubaiClock, isNewDevice, summaryWords } from "./password-alert-rules";
import { createAdminClient } from "./supabase/admin";

/**
 * PASSWORD SIGN-IN ALERTS (11 November 2026, Section 14). Called by the password login BEFORE it writes this sign-in:
 * the owner is told at once only when the browser is one this person never signed in from; every other password
 * sign-in waits for the evening summary.
 */
export async function alertIfNewDevice(staff: { id: string; display_name: string }): Promise<boolean> {
  const admin = createAdminClient();
  const ua = (await headers()).get("user-agent") ?? null;
  const { data } = await admin.from("sign_in_events").select("user_agent").eq("staff_id", staff.id).eq("ok", true).order("at", { ascending: false }).limit(200);
  const earlier = ((data ?? []) as { user_agent: string | null }[]).map((r) => r.user_agent);
  if (!isNewDevice(ua, earlier)) return false;
  await notifyStaff(await ownerIds(), {
    type: NEW_DEVICE_TYPE,
    title: `${staff.display_name} signed in with the password from a new device`,
    body: "A browser they never used before. Lost phone, or someone else using the password? Check with them. Only you can remove a lost phone (Team).",
    href: `/team/${staff.id}#sign-in`,
  });
  return true;
}

/**
 * The evening summary (hourly job): at the first run from 21:00 Dubai, once a day, "Password sign-ins today: ADARSH 3,
 * MERT 1" to the owner - information only, never in the red badge. Nothing to say, nothing sent.
 */
export async function passwordSummaryDaily(nowMs = Date.now()): Promise<number> {
  const { hour, dayStartIso } = dubaiClock(nowMs);
  if (hour < SUMMARY_HOUR) return 0;
  const admin = createAdminClient();
  const owners = await ownerIds();
  if (!owners.length) return 0;
  const { count } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("type", SUMMARY_TYPE).in("staff_id", owners).gte("created_at", dayStartIso);
  if ((count ?? 0) > 0) return 0;
  const { data } = await admin.from("sign_in_events").select("staff_id").eq("method", "password_backup").eq("ok", true).gte("at", dayStartIso);
  const ids = ((data ?? []) as { staff_id: string | null }[]).map((r) => r.staff_id).filter((x): x is string => !!x && !owners.includes(x));
  if (!ids.length) return 0;
  const { data: people } = await admin.from("staff").select("id, display_name").in("id", Array.from(new Set(ids)));
  const nameOf = new Map(((people ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const title = summaryWords(ids.map((id) => ({ name: nameOf.get(id) ?? "Someone" })));
  if (!title) return 0;
  await notifyStaff(owners, { type: SUMMARY_TYPE, title, body: "Each one used the password instead of their phone. Ask them if a phone is lost; the full list is on Team > Sign-ins.", href: "/team/sign-ins" });
  return ids.length;
}
