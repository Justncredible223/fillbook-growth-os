/**
 * Temporary, one-off admin script -- NOT part of the regular pipeline.
 * Dumps the current Prospecting queue so a fresh search's real candidates
 * (author, follower count, score, text) can be inspected directly, to
 * verify the crypto-exclusion and reach-weighting fixes landed correctly.
 * Delete this file after use; it is not meant to be a permanent script.
 */
import { getServiceClient } from "../../src/lib/supabaseClient.js";

async function main() {
  const client = getServiceClient();
  const { data, error } = await client
    .from("prospecting_candidates")
    .select("author_handle, author_follower_count, opportunity_score, discovery_query, post_text, discovered_at")
    .order("discovered_at", { ascending: false })
    .limit(15);
  if (error) throw new Error(`query failed: ${error.message}`);

  for (const row of data ?? []) {
    console.log("---");
    console.log(`@${row.author_handle} | ${row.author_follower_count} followers | score ${row.opportunity_score} | topic ${row.discovery_query}`);
    console.log((row.post_text as string).slice(0, 200));
  }
  console.log(`\nTotal rows: ${data?.length ?? 0}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
