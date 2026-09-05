/**
 * Runs `fn` over `items` with at most `limit` invocations in flight at
 * once, preserving input order in the result. Rejects on the first
 * failure (remaining work is left to finish or fail on its own -- the
 * caller has already been told the batch is broken). Used to fan out
 * bounded batches of database reads inside one serverless invocation
 * without either serializing them (slow) or firing hundreds at once
 * (connection pressure).
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`mapWithConcurrency: limit must be a positive integer, got ${limit}`);
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** Splits `items` into consecutive chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunk: size must be a positive integer, got ${size}`);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
