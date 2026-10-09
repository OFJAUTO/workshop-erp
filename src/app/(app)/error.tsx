"use client";

import { useEffect } from "react";
import { Button, Card, LinkButton, PageHeader } from "@/components/ui";

/**
 * Something went wrong on a page: a plain message in our own design instead of a black crash
 * screen, with a way to try again. What was typed stays in the browser's form boxes when the
 * page is tried again without a reload.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
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
