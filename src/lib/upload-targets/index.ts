import "server-only";
import type { UploadTarget } from "@/lib/upload-grant";
import type { TargetSpec } from "./common";
import { gateInTarget } from "./gate-in";
import { inspectionTarget } from "./inspection";
import { jobFileTarget } from "./job-file";
import { supplierProofTarget } from "./supplier-proof";
import { commissionProofTarget } from "./commission-proof";
import { creditNoteTarget } from "./credit-note";
import { looseItemTarget } from "./loose-item";

/** Every place a member of staff can send a file to, by name (the browser's queue names the place with each file). */
export const UPLOAD_TARGETS: Record<UploadTarget, TargetSpec> = {
  gate_in: gateInTarget,
  inspection: inspectionTarget,
  job_file: jobFileTarget,
  supplier_proof: supplierProofTarget,
  commission_proof: commissionProofTarget,
  credit_note: creditNoteTarget,
  loose_item: looseItemTarget,
};

export function targetOf(name: unknown): TargetSpec | null {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(UPLOAD_TARGETS, name) ? UPLOAD_TARGETS[name as UploadTarget] : null;
}
