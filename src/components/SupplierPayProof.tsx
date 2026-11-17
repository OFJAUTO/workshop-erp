"use client";

import { useRouter } from "next/navigation";
import { QueuedProofView, useQueuedProof } from "@/components/QueuedProofUpload";
import { refreshWhenIdle } from "@/lib/refresh-idle";

type Props = {
  /** The payment's id: an existing SPAY, or the id a new payment's form will save it under. */
  paymentId: string;
  /** Inside a form: the stored path goes with the save (proof_path / proof_pending). Outside: it joins the payment by itself. */
  inForm?: boolean;
};

/**
 * THE proof of a supplier payment (17 November 2026, Section 1): one picker for every place a supplier is paid - the
 * Supplier payments box, Pay in advance, the LPO's payment box and Correct this payment. The file belongs to the
 * PAYMENT, so an advance with no LPO takes its proof like any other, and a file that cannot be sent never stops the
 * payment being recorded (the words say so, and where to add it later).
 */
export function SupplierPayProof(props: Props) {
  return <PayProof key={props.paymentId} {...props} />;
}

function PayProof({ paymentId, inForm = false }: Props) {
  const router = useRouter();
  const proof = useQueuedProof({ target: "supplier_pay_proof", scopeId: paymentId, onSent: inForm ? undefined : () => refreshWhenIdle(() => router.refresh()) });
  return (
    <div className="flex min-w-40 flex-col gap-1" data-pay-proof-box data-pay-proof-for={paymentId}>
      <span className="text-xs font-semibold text-muted">Proof: bank slip, card slip, link receipt, signed receipt or cheque copy</span>
      <QueuedProofView
        proof={proof}
        label={proof.ready || proof.waiting ? "Use another file" : "Add the proof"}
        buttonClass="min-h-11 w-fit rounded-control border border-line-strong bg-white px-4 text-sm font-bold disabled:opacity-50"
        inputData={{ "data-pay-proof": "" }}
        buttonData={{ "data-supplier-proof-upload": "" }}
        pathName={inForm ? "proof_path" : undefined}
        pendingName={inForm ? "proof_pending" : undefined}
        readyWords={inForm ? "Proof ready" : "Proof saved"}
        waitingHint={inForm ? "You can record the payment now: the proof joins it by itself when it arrives." : undefined}
      />
      {proof.stopped ? (
        <p className="text-xs font-semibold text-red" data-pay-proof-stopped>
          This file could not be sent. The payment is NOT held up: record it now, then add the proof later from Payment history → Correct this payment (or tap Try again).
        </p>
      ) : null}
    </div>
  );
}
