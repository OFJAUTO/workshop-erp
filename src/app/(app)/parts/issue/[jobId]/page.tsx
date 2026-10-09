import { redirect } from "next/navigation";

/** The old "issue parts" screen: the handover with one PIN replaced it. */
export default async function IssuePartsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  redirect(`/parts/handover/${jobId}`);
}
