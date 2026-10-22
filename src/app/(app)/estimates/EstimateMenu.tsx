"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FloatingMenu } from "@/components/FloatingMenu";
import { ReasonChips } from "@/components/ReasonChips";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { cancelEstimate, copyEstimate, deleteEstimateDraft, extendEstimate } from "./actions";

function Item({ label, onClick, red = false, hook }: { label: string; onClick: () => void; red?: boolean; hook: string }) {
  return (
    <button type="button" onClick={onClick} className={`block w-full min-h-11 px-3 text-left text-sm hover:bg-canvas ${red ? "font-bold text-red" : "font-semibold"}`} data-estimate-action={hook}>
      {label}
    </button>
  );
}

/**
 * The "…" on an estimate (the list and the estimate page): Delete while being prepared, Cancel with a reason once sent
 * (kept under Cancelled / expired), Re-send / extend when expired, Copy for a variation. Each result opens in a centre
 * window at once; an accepted estimate offers Copy only.
 */
export function EstimateMenu({ id, number, status, neverSent, canManage }: { id: string; number: string; status: string; neverSent: boolean; canManage: boolean }) {
  const router = useRouter();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<"delete" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [send, setSend] = useState<{ message: string; phone: string; validUntil: string } | null>(null);
  const [pending, start] = useTransition();
  if (!canManage) return null;
  const canDelete = status === "draft" && neverSent;
  const canCancel = ["sent", "opened", "urgent_requested", "pending_owner", "expired", "declined"].includes(status);
  const canExtend = ["expired", "sent", "opened"].includes(status);
  const close = () => setAnchor(null);
  const run = (fn: () => Promise<void>) => start(async () => { setError(null); await fn(); });

  return (
    <span className="relative shrink-0" data-estimate-menu={number}>
      <button type="button" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} aria-label={`More for ${number}`} aria-expanded={!!anchor} className={`min-h-11 min-w-11 rounded-control border text-base font-bold ${anchor ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`} data-estimate-dots>
        ⋯
      </button>
      {anchor ? (
        <FloatingMenu anchor={anchor} onClose={close} width={240} label={`More for ${number}`}>
          {canExtend ? <Item hook="extend" label={status === "expired" ? "Re-send / extend" : "Re-send (fresh validity)"} onClick={() => { close(); run(async () => { const r = await extendEstimate(id); if (r.error) setError(r.error); else setSend({ message: r.message ?? "", phone: r.phone ?? "", validUntil: r.validUntil ?? "" }); }); }} /> : null}
          <Item hook="copy" label="Copy estimate" onClick={() => { close(); run(async () => { const r = await copyEstimate(id); if (r.error) setError(r.error); else router.push(`/estimates/${r.id}?message=${encodeURIComponent(`${r.number} copied from ${number}. The commission is not copied.`)}`); }); }} />
          {canCancel ? <Item hook="cancel" label="Cancel…" red onClick={() => { close(); setReason(""); setDialog("cancel"); }} /> : null}
          {canDelete ? <Item hook="delete" label="Delete…" red onClick={() => { close(); setDialog("delete"); }} /> : null}
        </FloatingMenu>
      ) : null}
      {pending ? <span className="ml-2 text-xs font-semibold text-muted">Working…</span> : null}
      {error && !dialog ? <span className="ml-2 text-xs font-semibold text-red" data-estimate-error>{error}</span> : null}
      {dialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" onClick={() => setDialog(null)} data-estimate-dialog={dialog}>
          <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-extrabold">{dialog === "delete" ? `Delete ${number}?` : `Cancel ${number}?`}</h2>
            {dialog === "delete" ? (
              <p className="text-sm">It was never sent to the customer. It goes from the list for good.</p>
            ) : (
              <>
                <p className="text-sm">The customer saw it, so it is kept under <b>Cancelled / expired</b>, never deleted. Their link says it was withdrawn.</p>
                <ReasonChips name="cancel_reason" label="Why?" rows={1} options={["Replaced by a new estimate", "Customer not interested", "Prices changed", "Duplicate"]} onValue={setReason} placeholder="For example: replaced by E-00011" />
              </>
            )}
            {error ? <p className="text-sm font-semibold text-red" data-estimate-error>{error}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setDialog(null)} className="min-h-11 rounded-control border border-line-strong bg-white px-4 text-sm font-bold">Keep it</button>
              <button
                type="button"
                disabled={pending || (dialog === "cancel" && reason.trim().length < 3)}
                onClick={() => run(async () => {
                  const r = dialog === "delete" ? await deleteEstimateDraft(id) : await cancelEstimate(id, reason);
                  if (r.error) { setError(r.error); return; }
                  setDialog(null);
                  router.refresh();
                })}
                className="min-h-11 rounded-control bg-red-bar px-4 text-sm font-bold text-white disabled:opacity-50"
                data-estimate-confirm
              >
                {dialog === "delete" ? "Delete" : "Cancel the estimate"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {send ? (
        <SendLinkDialog
          title={`Re-send ${number} · valid until ${new Date(send.validUntil).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dubai" })}`}
          message={send.message}
          phoneDigits={send.phone}
          onSent={() => router.refresh()}
          onClose={() => { setSend(null); router.refresh(); }}
        />
      ) : null}
    </span>
  );
}
