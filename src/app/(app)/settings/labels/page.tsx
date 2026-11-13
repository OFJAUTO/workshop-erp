import { redirect } from "next/navigation";

/** Printer setup moved to the Stickers tab (11 November 2026, Section 12). */
export default async function StickersSettingsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ tab: "printer", ...Object.fromEntries(Object.entries(sp).filter(([, v]) => !!v)) }).toString();
  redirect(`/labels?${q}#printer`);
}
