/**
 * Extracts a readable message from any thrown value. Supabase's
 * PostgrestError-like objects aren't always `instanceof Error` across
 * bundling boundaries, so `err instanceof Error ? err.message :
 * String(err)` silently degrades to "[object Object]" for them -- found
 * live via a real deployment (health endpoint reported "[object Object]"
 * instead of the actual Postgres error once the service role key was
 * finally read). This checks for a `.message` property structurally
 * instead of relying on `instanceof`.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
