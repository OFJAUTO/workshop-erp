import { Card, LinkButton, PageHeader } from "@/components/ui";

/** A missing page or a car that is not available to this person, in our own words, inside the normal frame. */
export default function NotFound() {
  return (
    <>
      <PageHeader title="Not here" subtitle="This page does not exist, or this car is not available to you." />
      <Card className="flex flex-col gap-3 max-w-xl">
        <p className="text-sm">If you came from a link in a message, the car may have moved on or be assigned to someone else. If you typed the address, check it.</p>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/home" size="md">Go to the start</LinkButton>
          <LinkButton href="/my-jobs" tone="secondary" size="md">My jobs</LinkButton>
        </div>
      </Card>
    </>
  );
}
