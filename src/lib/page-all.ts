/**
 * Reading many rows from Supabase without silent caps (3 November 2026, moved out of zoho-sync so the money list can
 * use it without loading the Zoho module). Pure helpers: no database of their own.
 */

/** Reads a whole table page by page: PostgREST caps one answer at 1,000 rows, which would blind a list or a backfill. */
export async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await fetchPage(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

/** A long id list in short pieces: an `in(...)` filter travels in the address, so 150 ids at a time stays well short. */
export function chunks<T>(list: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Every row for a long id list: each piece read page by page, the pieces in parallel, in the order of the list. */
export async function pageAllIn<T>(ids: string[], fetchPage: (ids: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return [];
  const parts = await Promise.all(chunks(unique).map((piece) => pageAll<T>((a, b) => fetchPage(piece, a, b))));
  return parts.flat();
}
