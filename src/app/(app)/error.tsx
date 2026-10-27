"use client";

import { useEffect, useState } from "react";
import { Button, Card, LinkButton, PageHeader } from "@/components/ui";
import { isStaleVersionError, reloadForNewVersion } from "@/lib/app-version";

/**
 * Something went wrong on a page: a plain message in our own design instead of a black crash
 * screen, with a way to try again. What was typed stays in the browser's form boxes when the
 * page is tried again without a reload.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleVersionError(error.message ?? "");
  // A click from a tab still running the previous version: the page reloads itself once (what was typed is saved
  // first); only when that already happened a moment ago does the person see the message below.
  const [reloading] = useState(() => stale && typeof window !== "undefined" && reloadForNewVersion());
  useEffect(() => {
    console.error(error);
  }, [error]);
  if (reloading) {
    return (
      <Card className="flex max-w-xl flex-col gap-2" data-version-reloading>
        <p className="text-sm font-semibold">A new version of the system is live. Loading it now…</p>
      </Card>
    );
  }
  if (stale) {
    return (
      <Card className="flex max-w-xl flex-col gap-3" data-version-stale>
        <p className="text-sm font-semibold">A new version of the system is live. Refresh the page to carry on; what you typed is kept.</p>
        <div><Button type="button" size="md" onClick={() => window.location.reload()}>Refresh</Button></div>
      </Card>
    );
  }
  const viewOnly = /view only/i.test(error.message);
  return (
    <>
      <PageHeader title="Something went wrong" subtitle={viewOnly ? "You are looking at the system as someone else, so nothing can be changed." : "The page could not finish what you asked."} />
      <Card className="flex flex-col gap-3 max-w-xl border-red-bar">
        <p className="text-sm">{viewOnly ? "Press Exit on the yellow bar to go back to your own screen, then try again." : "Try again. If it happens again, tell the owner what you were doing and which car it was; the problem has been recorded."}</p>
        {error.digest ? <p className="text-xs text-muted">Reference {error.digest}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="md" onClick={() => reset()}>Try again</Button>
          <LinkButton href="/home" tone="secondary" size="md">Go to the start</LinkButton>
        </div>
      </Card>
    </>
  );
}
