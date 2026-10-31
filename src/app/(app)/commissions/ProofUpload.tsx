"use client";

import { useRouter } from "next/navigation";
import { QueuedProofUpload } from "@/components/QueuedProofUpload";
import { refreshWhenIdle } from "@/lib/refresh-idle";

/**
 * The signed voucher photo or the bank slip, 31 October 2026: one picker that keeps the file on this device until OFJ's
 * server has it and sends it straight to storage, onto the payment (an expense already in Zoho runs once more to attach
 * it). The page shows "Proof ✓" when the server has it.
 */
export function ProofUpload({ paymentId, label = "Upload signed voucher" }: { paymentId: string; label?: string }) {
  const router = useRouter();
  return <QueuedProofUpload target="commission_proof" scopeId={paymentId} label={label} buttonData={{ "data-proof-upload": paymentId }} readyWords="Proof saved" onSent={() => refreshWhenIdle(() => router.refresh())} />;
}
