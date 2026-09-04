import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewNotification, Notification, NotificationRepository } from "./types";

function fromRow(row: Record<string, any>): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    severity: row.severity,
    createdAt: row.created_at,
    readAt: row.read_at,
    relatedId: row.related_id,
  };
}

export class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private client: SupabaseClient) {}

  async list(limit: number): Promise<Notification[]> {
    const { data, error } = await this.client
      .from("notifications")
      .select()
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(fromRow);
  }

  async countUnread(): Promise<number> {
    const { count, error } = await this.client
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    if (error) throw error;
    return count ?? 0;
  }

  async create(input: NewNotification): Promise<Notification> {
    const { data, error } = await this.client
      .from("notifications")
      .insert({
        type: input.type,
        title: input.title,
        body: input.body,
        severity: input.severity,
        related_id: input.relatedId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async markRead(id: string): Promise<void> {
    const { error } = await this.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  }

  async markAllRead(): Promise<void> {
    const { error } = await this.client
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    if (error) throw error;
  }
}

/**
 * Real inputs for decideNotifications() -- de-duplicates against
 * notifications already created (by relatedId) so a re-run of the daily
 * pipeline never notifies about the same opportunity/strategy version/
 * experiment twice.
 */
export async function collectNotificationInputs(
  client: SupabaseClient,
  failedSteps: Array<{ step: string; detail: string }>,
  sinceIso: string,
) {
  const { data: existingNotifs } = await client.from("notifications").select("related_id").gte("created_at", sinceIso);
  const alreadyNotified = new Set(((existingNotifs ?? []) as Array<{ related_id: string | null }>).map((n) => n.related_id));

  const { data: newOpportunities } = await client
    .from("opportunities")
    .select("id, title, score")
    .gte("created_at", sinceIso)
    .gte("score", 75);
  const newHighScoreOpportunities = ((newOpportunities ?? []) as Array<{ id: string; title: string; score: number }>).filter(
    (o) => !alreadyNotified.has(o.id),
  );

  const { data: latestStrategy } = await client
    .from("strategy_versions")
    .select("id, version, generated_at, topics_to_increase, topics_to_decrease, content_to_retire, formats_to_test")
    .gte("generated_at", sinceIso)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  let freshStrategyVersion: { version: number; actionableCount: number } | null = null;
  if (latestStrategy && !alreadyNotified.has(`strategy-${latestStrategy.version}`)) {
    const actionableCount =
      (latestStrategy.topics_to_increase?.length ?? 0) +
      (latestStrategy.topics_to_decrease?.length ?? 0) +
      (latestStrategy.content_to_retire?.length ?? 0) +
      (latestStrategy.formats_to_test?.length ?? 0);
    freshStrategyVersion = { version: latestStrategy.version, actionableCount };
  }

  const { data: experiments } = await client
    .from("experiments")
    .select("id, hypothesis, result")
    .not("result", "is", null);
  const newSignificantExperiments = ((experiments ?? []) as Array<{ id: string; hypothesis: string; result: any }>)
    .filter((e) => e.result?.isSignificant && e.result?.computedAt >= sinceIso && !alreadyNotified.has(e.id))
    .map((e) => ({ id: e.id, hypothesis: e.hypothesis, interpretation: e.result.interpretation as string }));

  return { failedSteps, newHighScoreOpportunities, freshStrategyVersion, newSignificantExperiments };
}
