import { LinkButton, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { packagesOf } from "@/lib/packages";
import { getSettings } from "@/lib/settings";
import { savePackages } from "./actions";
import { PackagesEditor } from "./PackagesEditor";

export const dynamic = "force-dynamic";

/** Owner only: the bodyshop packages the advisors sell at one price. */
export default async function PackagesSettingsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("manageSettings");
  const { message, error } = await searchParams;
  const settings = await getSettings();
  return (
    <>
      <PageHeader
        title="Bodyshop packages"
        subtitle="What each package includes, the warranty per product and the time in workshop. The advisor picks a package and types ONE price; the customer sees the list with no item prices."
        actions={<LinkButton href="/settings" tone="secondary" size="lg">Back to Settings</LinkButton>}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <PackagesEditor initial={packagesOf(settings)} action={savePackages} />
    </>
  );
}
