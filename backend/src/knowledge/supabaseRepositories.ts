import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BrandConstitutionRepository,
  BrandRule,
  KnowledgeBrainRepository,
  KnowledgeDocument,
} from "./types";

export class SupabaseBrandConstitutionRepository implements BrandConstitutionRepository {
  constructor(private client: SupabaseClient) {}

  async getActiveRules(): Promise<BrandRule[]> {
    const { data, error } = await this.client
      .from("brand_rules")
      .select("id, version, rule_type, content, source_doc, is_active")
      .eq("is_active", true)
      .order("version", { ascending: false });
    if (error) throw new Error(`getActiveRules failed: ${error.message}`);
    return (data ?? []).map((row) => ({
      id: row.id,
      version: row.version,
      ruleType: row.rule_type,
      content: row.content,
      sourceDoc: row.source_doc,
      isActive: row.is_active,
    }));
  }
}

export class SupabaseKnowledgeBrainRepository implements KnowledgeBrainRepository {
  constructor(private client: SupabaseClient) {}

  async getByTopic(topic: string): Promise<KnowledgeDocument[]> {
    const { data, error } = await this.client
      .from("knowledge_documents")
      .select("id, topic, title, content, source_doc, trust_level")
      .eq("topic", topic);
    if (error) throw new Error(`getByTopic failed: ${error.message}`);
    return (data ?? []).map((row) => ({
      id: row.id,
      topic: row.topic,
      title: row.title,
      content: row.content,
      sourceDoc: row.source_doc,
      trustLevel: row.trust_level,
    }));
  }
}
