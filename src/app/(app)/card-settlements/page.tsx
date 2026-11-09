import { redirect } from "next/navigation";

/** "Card settlements" became "Accounts posting" (9 November 2026): old links and bookmarks land on the new page. */
export default async function OldCardSettlements({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  redirect(`/accounts-posting${q.toString() ? `?${q.toString()}` : ""}`);
}
