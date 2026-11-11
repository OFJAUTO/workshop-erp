import "server-only";
import type { ApprovalKind } from "@/lib/approvals";

/**
 * Decisions of the approval kinds added after the list was built (receipt voids, inspection downgrades): each later
 * section registers its decision here, so the ONE dispatcher (approvals/actions.ts) reaches it.
 */
type Decide = (id: string, approve: boolean, note: string, staff: { id: string; display_name: string; role_id: string }) => Promise<{ ok?: boolean; error?: string; message?: string }>;
const deciders = new Map<string, Decide>();

export function registerApprovalDecision(kind: ApprovalKind, fn: Decide) {
  deciders.set(kind, fn);
}

export async function runMoreDecision(kind: ApprovalKind, id: string, approve: boolean, note: string, staff: { id: string; display_name: string; role_id: string }): Promise<{ ok?: boolean; error?: string; message?: string }> {
  const fn = deciders.get(kind);
  if (!fn) return { error: "This kind of approval cannot be decided here yet: open its page." };
  return fn(id, approve, note, staff);
}
