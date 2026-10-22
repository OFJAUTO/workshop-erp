import "server-only";
import { TintSpecBox } from "@/components/TintSpecBox";
import type { Settings } from "@/lib/settings";
import { cleanTintSpec } from "@/lib/tint";
import { lastTintSpecFor, tintLimitOf, tintPresetsOf, tintStageStarted } from "@/lib/tint-data";

/**
 * Section 11: the ONE tint box behind the quotation and the estimate pages - the saved specification, the owner's
 * presets, "Same as last time" from this car (else the customer's other cars), the legal limit, and whether it can
 * still change (until the tint work starts; the owner can always correct it).
 */
export async function TintSpecPanel({ quotation, settings, isOwner, viewOnly }: { quotation: { id: string; job_id: string | null; status: string; tint_spec?: unknown; vehicle_id?: string | null; customer_id?: string | null }; settings: Settings; isOwner: boolean; viewOnly: boolean }) {
  const [stage, lastTime] = await Promise.all([tintStageStarted(quotation.job_id), lastTintSpecFor(quotation.vehicle_id ?? null, quotation.customer_id ?? null, quotation.id)]);
  const replaced = quotation.status === "superseded" || quotation.status === "cancelled";
  const lockedReason = viewOnly
    ? "View only: the tint choice cannot be changed from here."
    : replaced
      ? "This version was replaced: the newest version carries the tint choice."
      : stage.started && !isOwner
        ? `The tint work has started (${stage.label}): the choice can no longer change. The owner can still correct it.`
        : null;
  return (
    <TintSpecBox
      quotationId={quotation.id}
      initial={cleanTintSpec(quotation.tint_spec)}
      presets={tintPresetsOf(settings)}
      lastTime={lastTime}
      limit={tintLimitOf(settings)}
      mode={quotation.status === "draft" || quotation.status === "pending_owner" ? "draft" : "sent"}
      lockedReason={lockedReason}
      isOwner={isOwner}
      doubleLayerHours={Number(settings.tint_double_layer_hours) >= 0 ? Number(settings.tint_double_layer_hours) || 0 : 1}
    />
  );
}
