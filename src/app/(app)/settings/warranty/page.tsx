import { Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { periodWords, TERMS_KEYS, TERMS_LABELS, termsOf } from "@/lib/warranty";
import { saveWarrantyTerms } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Section 12: Settings > Warranty terms (owner). Per product - PPF, tint, ceramic, mechanical workmanship - the
 * warranty period, a 2-3 line short version (on the tax invoice, the certificate and the warranty page) and the
 * full text (behind "Full terms"). Starts with neutral standard wording for the owner to rewrite.
 */
export default async function WarrantyTermsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("manageSettings");
  const { message, error } = await searchParams;
  const terms = termsOf((await getSettings()).warranty_terms);
  return (
    <>
      <PageHeader
        title="Warranty terms"
        subtitle="What each warranty covers and for how long. The short version prints on the tax invoice and the certificate; the full text opens from the customer's warranty page."
        actions={<LinkButton href="/settings" tone="secondary" size="lg">Back to Settings</LinkButton>}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form action={saveWarrantyTerms} className="flex flex-col gap-4" data-warranty-terms-form>
        {TERMS_KEYS.map((k) => (
          <Card key={k} className="flex flex-col gap-3" data-terms={k}>
            <SectionLabel right={periodWords(terms[k].months)}>{TERMS_LABELS[k]}</SectionLabel>
            <label className="flex max-w-xs flex-col gap-1 text-xs font-semibold text-muted">
              Warranty period (months; 120 = 10 years)
              <Input name={`${k}_months`} defaultValue={String(terms[k].months)} inputMode="numeric" data-terms-months={k} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Short version (2-3 lines: on the invoice, the certificate and the warranty page)
              <Textarea name={`${k}_short`} defaultValue={terms[k].short} rows={3} data-terms-short={k} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Full text (opens from &quot;Full terms&quot; on the warranty page)
              <Textarea name={`${k}_full`} defaultValue={terms[k].full} rows={6} data-terms-full={k} />
            </label>
          </Card>
        ))}
        <p className="text-xs text-muted">A package item&apos;s own warranty words (for example &quot;10-year warranty&quot;) set that item&apos;s period; these periods apply where the package says none.</p>
        <div><Button type="submit" size="lg" data-save-terms>Save the warranty terms</Button></div>
      </form>
    </>
  );
}
