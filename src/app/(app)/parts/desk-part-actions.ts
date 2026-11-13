"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { addDeskParts, decideDeskPart, type DeskAnswer, type DeskEntry } from "@/lib/desk-parts";

/** The parts desk's "+ Add a part" on an estimate (13 November 2026, Section 5): one or more parts, optionally for one job. */
export async function addDeskPartsAction(estimateId: string, entries: DeskEntry[], forLineId: string | null): Promise<DeskAnswer> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "View as is read-only." };
  const r = await addDeskParts(estimateId, entries, forLineId, staff);
  revalidatePath(`/parts/estimate/${estimateId}`);
  revalidatePath(`/estimates/${estimateId}`);
  return r;
}

/** The advisor's Accept or Decline of a part the desk added. */
export async function decideDeskPartAction(estimateId: string, lineId: string, accept: boolean): Promise<DeskAnswer> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "View as is read-only." };
  const r = await decideDeskPart(lineId, accept, staff);
  revalidatePath(`/estimates/${estimateId}`);
  revalidatePath(`/parts/estimate/${estimateId}`);
  return r;
}
