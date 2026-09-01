import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Not a secret -- Supabase project URLs are meant to be public (protection
// comes from RLS + the service_role key below, never from hiding the URL).
const SUPABASE_URL = "https://aijnibayogdygtykidta.supabase.co";

let cachedClient: SupabaseClient | null = null;

/**
 * Server-side only. Uses the service_role key, which bypasses RLS -- this
 * must NEVER be imported by anything that ships to the Android app or any
 * browser bundle. API route handlers (backend/api/*.ts) are the only
 * intended callers.
 */
export function getServiceClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it in the Vercel project's " +
        "environment variables (Settings -> Environment Variables) -- this key " +
        "is never entered by Claude and must be set by the project owner.",
    );
  }
  cachedClient = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return cachedClient;
}
