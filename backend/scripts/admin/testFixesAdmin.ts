/**
 * Temporary, one-off admin script -- NOT part of the regular pipeline.
 * Dumps the current Prospecting queue THROUGH the real isPlausiblyTradingRelated
 * filter (the same one listProspectingQueue applies before the app ever sees a
 * candidate) so the crypto-exclusion and reach-weighting fixes can be verified
 * against what the owner would actually see, not the raw unfiltered table.
 * Delete this file after use; it is not meant to be a permanent script.
 */
import { getServiceClient } from "../../src/lib/supabaseClient.js";
import { isPlausiblyTradingRelated } from "../../src/prospecting/prospectingRelevance.js";

async function main() {
  const client = getServiceClient();
  const { data, error } = await client
    .from("prospecting_candidates")
    .select("author_handle, author_follower_count, opportunity_score, discovery_query, post_text, discovered_at")
    .order("discovered_at", { ascending: false })
    .limit(15);
  if (error) throw new Error(`query failed: ${error.message}`);

  let shown = 0;
  let filtered = 0;
  for (const row of data ?? []) {
    const relevant = isPlausiblyTradingRelated(row.post_text as string);
    if (relevant) shown++;
    else filtered++;
    console.log("---");
    console.log(`[${relevant ? "SHOWN" : "FILTERED (not trading-related)"}] @${row.author_handle} | ${row.author_follower_count} followers | score ${row.opportunity_score} | topic ${row.discovery_query}`);
    console.log((row.post_text as string).slice(0, 200));
  }
  console.log(`\nTotal: ${data?.length ?? 0} -- shown: ${shown}, filtered: ${filtered}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
