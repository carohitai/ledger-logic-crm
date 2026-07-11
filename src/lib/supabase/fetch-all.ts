/**
 * Pages through a Supabase query 1000 rows at a time (the PostgREST default
 * row cap), so aggregate screens see every row instead of a silent first page.
 * `maxRows` bounds runaway tables like call_logs.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  maxRows = 50000
): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += size) {
    const { data, error } = await page(from, Math.min(from + size, maxRows) - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}
