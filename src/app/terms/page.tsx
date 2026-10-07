import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "OFJ Automotive, Terms and Conditions", robots: { index: false, follow: false } };

/** Terms and conditions in English and Arabic. With ?t=<approval token> it shows the exact text that approval was based on. */
export default async function TermsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const settings = await getSettings();
  let text = String(settings.terms_and_conditions ?? "");
  let textAr = String(settings.terms_and_conditions_ar ?? "");
  if (t) {
    const admin = createAdminClient();
    const { data } = await admin.from("approval_requests").select("terms_text, terms_text_ar").eq("token", t).maybeSingle();
    if (data?.terms_text) {
      text = data.terms_text;
      textAr = data.terms_text_ar ?? "";
    }
  }
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-sidebar text-white px-5 py-4 flex items-center justify-between">
        <Logo onDark className="h-10" alt={settings.company_name} />
        <span className="text-xs text-white/70">{settings.company_name}</span>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 flex flex-col gap-4">
        <h1 className="text-3xl font-extrabold">Terms and conditions</h1>
        {text ? (
          <div className="bg-white border border-line rounded-card p-5 text-[15px] leading-relaxed whitespace-pre-wrap">{text}</div>
        ) : (
          <p className="text-sm text-muted">The terms and conditions have not been added yet.</p>
        )}
        {textAr ? (
          <div className="bg-white border border-line rounded-card p-5 text-[15px] leading-relaxed whitespace-pre-wrap" dir="rtl" lang="ar">
            {textAr}
          </div>
        ) : null}
      </main>
    </div>
  );
}
