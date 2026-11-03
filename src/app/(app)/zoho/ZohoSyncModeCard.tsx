import { Button, Card, SectionLabel } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { SYNC_MODE_WORDS, itemsWord, type ZohoSyncMode } from "@/lib/zoho-sync-rules";
import { setZohoSyncModeAction } from "./actions";

/**
 * 11.5: THE owner's switch between manual and automatic sending to Zoho (3 November 2026), the same card on the Zoho
 * Books page and on Settings > Zoho Books. Shown to the owner only (from his own login); the server refuses anyone else.
 * Going automatic asks once: from then on what waits is sent without a preview.
 */
export function ZohoSyncModeCard({ mode, waiting, back }: { mode: ZohoSyncMode; waiting: number; back: "/zoho" | "/settings/zoho" }) {
  return (
    <Card className="flex flex-col gap-3" data-zoho-mode-card={mode}>
      <SectionLabel right={SYNC_MODE_WORDS[mode].title}>Sending to Zoho</SectionLabel>
      <p className="text-sm">
        <span className="font-bold">Now: {SYNC_MODE_WORDS[mode].title}.</span> {SYNC_MODE_WORDS[mode].line}
      </p>
      <form action={setZohoSyncModeAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="back" value={back} />
        {mode === "manual" ? (
          <ConfirmSubmit
            label="Switch to automatic"
            title="Send to Zoho automatically?"
            lines={[
              "Every five minutes the system sends what is waiting by itself (25 at a time), without a preview.",
              waiting ? `${itemsWord(waiting)} waiting now would start going within five minutes.` : "Nothing is waiting now.",
              "You can switch back to manual here at any time.",
            ]}
            confirmLabel="Yes, send automatically"
            name="mode"
            value="automatic"
            tone="secondary"
            size="md"
            hook="zoho-mode"
            attrs={{ "data-zoho-mode-switch": "automatic" }}
          />
        ) : (
          <>
            <input type="hidden" name="mode" value="manual" />
            <Button type="submit" size="md" data-zoho-mode-switch="manual">
              Switch to manual
            </Button>
          </>
        )}
        <span className="text-xs text-muted">Only the owner changes this; the change is written to the change log and accounts are told.</span>
      </form>
    </Card>
  );
}
