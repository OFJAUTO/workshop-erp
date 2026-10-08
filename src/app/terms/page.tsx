import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { LinkButton } from "@/components/ui";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "OFJ Automotive, Terms and Conditions", robots: { index: false, follow: false } };

/**
 * Terms and conditions in English and Arabic on their own page. With ?t=<approval token>
 * it shows the exact text that approval was based on, records that the customer opened
 * the terms (with the time) on the job's change log, and offers a way back to the approval.
 */
export default async function TermsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const settings = await getSettings();
  let text = String(settings.terms_and_conditions ?? "");
  let textAr = String(settings.terms_and_conditions_ar ?? "");
  let backHref: string | null = null;
  if (t) {
    const admin = createAdminClient();
    const { data } = await admin.from("approval_requests").select("id, job_id, terms_text, terms_text_ar, approved_at").eq("token", t).maybeSingle();
    if (data?.terms_text) {
      text = data.terms_text;
      textAr = data.terms_text_ar ?? "";
      backHref = `/approve/${t}#approval`;
      await admin.from("job_events").insert({
        job_id: data.job_id,
        event_type: "terms_opened",
        note: `Customer opened the terms and conditions from the approval link${data.approved_at ? " (after approving)" : ""}`,
      });
    }
  }
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-sidebar text-white px-4 py-3 flex items-center justify-between gap-3">
        <Logo onDark className="h-9" alt={settings.company_name} />
        {backHref ? (
          <LinkButton href={backHref} tone="secondary" size="md">
            Back to approval
          </LinkButton>
        ) : (
          <span className="text-xs text-white/70">{settings.company_name}</span>
        )}
      </header>
      <main className="mx-auto max-w-2xl px-4 py-5 flex flex-col gap-4">
        <h1 className="text-2xl font-extrabold">Terms and conditions</h1>
        {text ? (
          <div className="bg-white border border-line rounded-card p-5 text-[15px] leading-relaxed whitespace-pre-wrap">{text}</div>
        ) : (
          <p className="text-sm text-muted">The terms and conditions have not been added yet.</p>
        )}
        {textAr ? (
          <>
            <h2 className="text-xl font-extrabold" dir="rtl" lang="ar">
              الشروط والأحكام
            </h2>
            <div className="bg-white border border-line rounded-card p-5 text-[15px] leading-relaxed whitespace-pre-wrap" dir="rtl" lang="ar">
              {textAr}
            </div>
          </>
        ) : null}
        {backHref ? (
          <div className="sticky bottom-0 py-3 bg-canvas">
            <LinkButton href={backHref} size="lg" className="w-full">
              Back to approval
            </LinkButton>
          </div>
        ) : null}
      </main>
    </div>
  );
}
