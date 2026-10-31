"use client";

import { useRouter } from "next/navigation";
import { QueuedProofView, useQueuedProof } from "@/components/QueuedProofUpload";
import { refreshWhenIdle } from "@/lib/refresh-idle";

type Props = { poId: string; inForm?: boolean };

/**
 * The proof of a supplier payment (bank slip, card slip, signed receipt or cheque copy), 31 October 2026: one picker that
 * keeps the file on this device until OFJ's server has it, then sends it straight to storage (no signal is fine).
 *
 * After "Paid to supplier" (`inForm` off) the proof lands on the LPO by itself and the page shows it. Inside the "Paid to
 * supplier" form (`inForm`) the stored path goes with the payment; a proof still on its way when the button is pressed
 * lands on the LPO by itself when it arrives, so nobody waits for it. Each LPO starts afresh (the key): a proof picked on
 * one LPO is never handed over with another.
 */
export function SupplierProofUpload(props: Props) {
  return <SupplierProof key={props.poId} {...props} />;
}

function SupplierProof({ poId, inForm = false }: Props) {
  const router = useRouter();
  const proof = useQueuedProof({ target: "supplier_proof", scopeId: poId, onSent: inForm ? undefined : () => refreshWhenIdle(() => router.refresh()) });
  if (!inForm) return <QueuedProofView proof={proof} label="Upload the proof" buttonData={{ "data-supplier-proof-upload": "" }} readyWords="Proof saved" />;
  return (
    <div className="flex min-w-40 flex-col gap-1" data-pay-proof-box>
      <span className="text-xs font-semibold text-muted">Proof: bank slip, card slip, signed receipt or cheque copy</span>
      <QueuedProofView
        proof={proof}
        label={proof.ready || proof.waiting ? "Use another file" : "Add the proof"}
        buttonClass="min-h-11 w-fit rounded-control border border-line-strong bg-white px-4 text-sm font-bold disabled:opacity-50"
        inputData={{ "data-pay-proof": "" }}
        pathName="proof_path"
        pendingName="proof_pending"
        readyWords="Proof ready"
        waitingHint="You can mark it paid now: the proof joins the LPO by itself when it arrives."
      />
    </div>
  );
}
