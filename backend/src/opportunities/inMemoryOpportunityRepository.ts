import { randomUUID } from "node:crypto";
import type { Opportunity, OpportunityRepository } from "./types.js";

export class InMemoryOpportunityRepository implements OpportunityRepository {
  private items: Opportunity[] = [];

  async insert(opportunity: Omit<Opportunity, "id" | "status" | "createdAt">): Promise<Opportunity> {
    const row: Opportunity = { ...opportunity, id: randomUUID(), status: "open", createdAt: new Date() };
    this.items.push(row);
    return row;
  }

  async listOpen(): Promise<Opportunity[]> {
    return this.items.filter((o) => o.status === "open").sort((a, b) => b.score - a.score);
  }

  _all(): Opportunity[] {
    return this.items;
  }
}
