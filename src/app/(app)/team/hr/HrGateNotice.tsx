import { LinkButton, Notice, PageHeader } from "@/components/ui";

/** What HR says when it cannot open: a phone sign-in is needed, or the person is viewing as someone, or not applied yet. */
export function HrGateNotice({ why }: { why: "passkey" | "viewing" | "not_ready" }) {
  return (
    <>
      <PageHeader title="HR" subtitle="The people file: details and documents." />
      {why === "passkey" ? (
        <div className="flex flex-col gap-3" data-hr-gate="passkey">
          <Notice tone="info">HR holds passports and IDs, so it opens only for an account with a phone sign-in (passkey). Set one up on your phone first; it takes a minute.</Notice>
          <LinkButton href="/passkey/setup?next=%2Fteam%2Fhr" className="self-start">Set up my phone sign-in</LinkButton>
        </div>
      ) : why === "viewing" ? (
        <div data-hr-gate="viewing"><Notice tone="info">HR does not open while viewing or acting as someone else. Go back to your own view first.</Notice></div>
      ) : (
        <div data-hr-gate="not_ready"><Notice tone="info">HR switches on with the next database apply (on the WAITING FOR APPLY list).</Notice></div>
      )}
    </>
  );
}
