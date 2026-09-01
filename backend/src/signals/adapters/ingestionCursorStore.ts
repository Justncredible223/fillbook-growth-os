import type { SupabaseClient } from "@supabase/supabase-js";

export interface IngestionCursorStore {
  load(source: string): Promise<string | null>;
  save(source: string, lastExternalId: string): Promise<void>;
}

export class InMemoryIngestionCursorStore implements IngestionCursorStore {
  private cursors = new Map<string, string>();

  async load(source: string): Promise<string | null> {
    return this.cursors.get(source) ?? null;
  }

  async save(source: string, lastExternalId: string): Promise<void> {
    this.cursors.set(source, lastExternalId);
  }
}

export class SupabaseIngestionCursorStore implements IngestionCursorStore {
  constructor(private client: SupabaseClient) {}

  async load(source: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("signal_ingestion_cursors")
      .select("last_external_id")
      .eq("source", source)
      .maybeSingle();
    if (error) throw new Error(`load ingestion cursor failed: ${error.message}`);
    return (data as { last_external_id: string } | null)?.last_external_id ?? null;
  }

  async save(source: string, lastExternalId: string): Promise<void> {
    const { error } = await this.client.from("signal_ingestion_cursors").upsert({
      source,
      last_external_id: lastExternalId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`save ingestion cursor failed: ${error.message}`);
  }
}
