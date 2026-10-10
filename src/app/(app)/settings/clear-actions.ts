"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { clearTestData } from "@/lib/clear-test-data";
import type { FormState } from "@/lib/form-state";
import { getSettings } from "@/lib/settings";

/** Owner only, while the testing-phase setting is on, with the phrase typed exactly. */
export async function clearTestDataAction(_state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("manageSettings");
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (staff.role_id !== "owner" || staff.viewingAs || staff.actingAs) return { error: "Only the owner, from his own login.", values: { confirm } };
  const settings = await getSettings();
  if (settings.test_mode_enabled !== true) return { error: "The testing phase is switched off in Settings; the button does nothing now.", values: { confirm } };
  if (confirm !== "CLEAR TEST DATA") return { error: "Type CLEAR TEST DATA exactly to confirm.", values: { confirm } };
  try {
    const r = await clearTestData({ id: staff.id, display_name: staff.display_name });
    const rows = Object.values(r.deleted).reduce((a, b) => a + b, 0);
    const files = Object.values(r.filesDeleted).reduce((a, b) => a + b, 0);
    const report = [`Backup: storage bucket "${r.backupPath}" (${r.backedUpRows} rows).`, `Deleted ${rows} rows: ${Object.entries(r.deleted).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(", ") || "nothing"}.`, `Deleted ${files} files: ${Object.entries(r.filesDeleted).filter(([, n]) => n > 0).map(([b, n]) => `${b} ${n}`).join(", ") || "none"}.`, "Numbering starts again at 00001."].join("\n");
    revalidatePath("/", "layout");
    return { success: "Test data cleared.", values: { report } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not clear the test data.", values: { confirm } };
  }
}
