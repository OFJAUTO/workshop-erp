import "server-only";
import { schemaReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";

/** Migration 20261202120000_line_teams: the team chosen on a quotation line (quotation_lines.team). */
export const teamsReady = () => schemaReady("quotation_lines", "team");

/**
 * The chosen team of each line (null where nobody chose one, or before the migration): read by quotation, so a long
 * list of lines never makes a long address. The defaults (line-teams.ts) fill the rest.
 */
export async function attachTeams<T extends { id: string; quotation_id: string }>(lines: T[]): Promise<(T & { team: string | null })[]> {
  if (!lines.length || !(await teamsReady())) return lines.map((l) => ({ ...l, team: null }));
  const qids = Array.from(new Set(lines.map((l) => l.quotation_id)));
  const { data } = await createAdminClient().from("quotation_lines").select("id, team").in("quotation_id", qids).not("team", "is", null);
  const m = new Map((data ?? []).map((r) => [r.id as string, (r.team as string | null) ?? null]));
  return lines.map((l) => ({ ...l, team: m.get(l.id) ?? null }));
}

/** The services behind the lines, with what the team defaults read (name, department, package kind, outside work). */
export async function servicesFor(serviceIds: string[]): Promise<Map<string, { id: string; name: string | null; department: string | null; bodyshop_kind: string | null; outside_work: boolean | null }>> {
  const ids = Array.from(new Set(serviceIds.filter(Boolean)));
  if (!ids.length) return new Map();
  const { data } = await createAdminClient().from("services").select("id, name, department, bodyshop_kind, outside_work").in("id", ids);
  return new Map(((data ?? []) as { id: string; name: string | null; department: string | null; bodyshop_kind: string | null; outside_work: boolean | null }[]).map((s) => [s.id, s]));
}
