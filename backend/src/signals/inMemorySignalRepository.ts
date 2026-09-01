import { randomUUID } from "node:crypto";
import type { Signal, SignalRepository } from "./types";

export class InMemorySignalRepository implements SignalRepository {
  private signals: Signal[] = [];

  async insert(signal: Omit<Signal, "id" | "clusterId">): Promise<Signal> {
    const row: Signal = { ...signal, id: randomUUID(), clusterId: null };
    this.signals.push(row);
    return row;
  }

  async findRecentByTopic(topic: string, sinceHours: number, now: Date = new Date()): Promise<Signal[]> {
    const cutoff = now.getTime() - sinceHours * 60 * 60 * 1000;
    return this.signals.filter((s) => s.topic === topic && s.observedAt.getTime() >= cutoff);
  }

  async assignCluster(signalId: string, clusterId: string): Promise<void> {
    const signal = this.signals.find((s) => s.id === signalId);
    if (signal) signal.clusterId = clusterId;
  }

  _all(): Signal[] {
    return this.signals;
  }
}
