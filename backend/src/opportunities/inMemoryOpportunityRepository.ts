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

  async expireStale(olderThan: Date): Promise<number> {
    let count = 0;
    for (const item of this.items) {
      if (item.status === "open" && item.createdAt < olderThan) {
        item.status = "expired";
        count++;
      }
    }
    return count;
  }

  _all(): Opportunity[] {
    return this.items;
  }
}
