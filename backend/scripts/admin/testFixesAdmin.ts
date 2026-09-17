/**
 * Temporary, one-off admin script -- NOT part of the regular pipeline.
 * Clears the current Prospecting queue (marks non-terminal candidates
 * not_relevant) so the next fresh search is easy to inspect on its own.
 * Delete this file after use; it is not meant to be a permanent script.
 */
import { getServiceClient } from "../../src/lib/supabaseClient.js";

async function main() {
  const client = getServiceClient();
  const { data: cleared, error: clearError } = await client
    .from("prospecting_candidates")
    .update({ status: "not_relevant" })
    .in("status", ["new", "shown", "drafting", "ready"])
    .select("id");
  if (clearError) throw new Error(`clear prospecting queue failed: ${clearError.message}`);
  console.log(`Cleared ${cleared?.length ?? 0} prospecting candidates (marked not_relevant).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
