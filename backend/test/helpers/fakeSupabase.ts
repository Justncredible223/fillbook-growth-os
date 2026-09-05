/**
 * A deliberately small in-memory stand-in for the subset of the
 * supabase-js query builder this project's repositories use. Filters are
 * applied to plain row arrays; nested selects are served from whatever
 * nested objects the fixture rows already carry (the select string is
 * recorded but not interpreted). Every executed query is logged so tests
 * can assert on query COUNT and SHAPE, and any table can be told to fail
 * so error propagation is testable without a network.
 */
import { vi } from "vitest";

export type FakeRow = Record<string, any>;

export interface FakeQueryLog {
  table: string;
  op: "select" | "update" | "insert" | "upsert" | "delete";
  filters: Array<{ kind: string; column: string; value: unknown }>;
  select?: string;
  payload?: unknown;
  head?: boolean;
  limit?: number;
}

export interface FakeError {
  message: string;
  code?: string;
}

export class FakeSupabaseClient {
  readonly log: FakeQueryLog[] = [];
  private failures = new Map<string, FakeError>();
  /** Optional hook invoked before each query executes -- used to measure concurrency. */
  onExecute?: (log: FakeQueryLog) => Promise<void> | void;

  constructor(public tables: Record<string, FakeRow[]> = {}) {}

  /** Make every query against `table` (optionally only `op`) resolve with this error. */
  failTable(table: string, error: FakeError, op?: FakeQueryLog["op"]) {
    this.failures.set(op ? `${table}:${op}` : table, error);
  }

  from(table: string) {
    return new FakeQueryBuilder(this, table);
  }

  /** @internal */
  failureFor(table: string, op: FakeQueryLog["op"]): FakeError | undefined {
    return this.failures.get(`${table}:${op}`) ?? this.failures.get(table);
  }

  queriesFor(table: string): FakeQueryLog[] {
    return this.log.filter((q) => q.table === table);
  }
}

class FakeQueryBuilder implements PromiseLike<{ data: any; error: FakeError | null; count?: number | null }> {
  private entry: FakeQueryLog;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;
  private countMode = false;

  constructor(private client: FakeSupabaseClient, table: string) {
    this.entry = { table, op: "select", filters: [] };
  }

  select(columns?: string, options?: { count?: string; head?: boolean }) {
    if (this.entry.op === "select") this.entry.select = columns ?? "*";
    if (options?.head) this.entry.head = true;
    if (options?.count) this.countMode = true;
    return this;
  }
  eq(column: string, value: unknown) { this.entry.filters.push({ kind: "eq", column, value }); return this; }
  neq(column: string, value: unknown) { this.entry.filters.push({ kind: "neq", column, value }); return this; }
  gte(column: string, value: unknown) { this.entry.filters.push({ kind: "gte", column, value }); return this; }
  gt(column: string, value: unknown) { this.entry.filters.push({ kind: "gt", column, value }); return this; }
  lt(column: string, value: unknown) { this.entry.filters.push({ kind: "lt", column, value }); return this; }
  lte(column: string, value: unknown) { this.entry.filters.push({ kind: "lte", column, value }); return this; }
  in(column: string, values: unknown[]) { this.entry.filters.push({ kind: "in", column, value: values }); return this; }
  is(column: string, value: unknown) { this.entry.filters.push({ kind: "is", column, value }); return this; }
  not(column: string, operator: string, value: unknown) { this.entry.filters.push({ kind: `not.${operator}`, column, value }); return this; }
  ilike(column: string, pattern: string) { this.entry.filters.push({ kind: "ilike", column, value: pattern }); return this; }
  /** Minimal PostgREST-style `or("col.eq.val,col2.eq.val2")` support -- only the `eq` operator, since that's all this project's callers use. */
  or(filterString: string) { this.entry.filters.push({ kind: "or", column: "", value: filterString }); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.orderBy = { column, ascending: options?.ascending ?? true }; return this; }
  limit(n: number) { this.entry.limit = n; return this; }
  maybeSingle() { this.singleMode = "maybeSingle"; return this; }
  single() { this.singleMode = "single"; return this; }
  update(payload: FakeRow) { this.entry.op = "update"; this.entry.payload = payload; return this; }
  insert(payload: FakeRow | FakeRow[]) { this.entry.op = "insert"; this.entry.payload = payload; return this; }
  upsert(payload: FakeRow | FakeRow[]) { this.entry.op = "upsert"; this.entry.payload = payload; return this; }
  delete() { this.entry.op = "delete"; return this; }

  private matches(row: FakeRow): boolean {
    return this.entry.filters.every(({ kind, column, value }) => {
      const actual = row[column];
      switch (kind) {
        case "eq": return actual === value;
        case "neq": return actual !== value;
        case "gte": return actual >= (value as any);
        case "gt": return actual > (value as any);
        case "lt": return actual < (value as any);
        case "lte": return actual <= (value as any);
        case "in": return (value as unknown[]).includes(actual);
        case "is": return value === null ? actual === null || actual === undefined : actual === value;
        case "not.is": return value === null ? actual !== null && actual !== undefined : actual !== value;
        case "ilike": {
          if (actual === null || actual === undefined) return false;
          const pattern = String(value).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
          return new RegExp(`^${pattern}$`).test(String(actual).toLowerCase());
        }
        case "or": {
          const clauses = String(value).split(",");
          return clauses.some((clause) => {
            const match = /^([^.]+)\.([^.]+)\.(.*)$/.exec(clause);
            if (!match) return false;
            const [, col, op, val] = match;
            if (op !== "eq" || !col) return false;
            return row[col] === val;
          });
        }
        default: throw new Error(`FakeSupabaseClient: unsupported filter ${kind}`);
      }
    });
  }

  private async execute(): Promise<{ data: any; error: FakeError | null; count?: number | null }> {
    this.client.log.push(this.entry);
    if (this.client.onExecute) await this.client.onExecute(this.entry);

    const failure = this.client.failureFor(this.entry.table, this.entry.op);
    if (failure) return { data: null, error: failure, count: null };

    const rows = this.client.tables[this.entry.table] ?? [];

    if (this.entry.op === "insert" || this.entry.op === "upsert") {
      const inserted = (Array.isArray(this.entry.payload) ? this.entry.payload : [this.entry.payload]) as FakeRow[];
      const withIds = inserted.map((r, i) => ({ id: `${this.entry.table}-${rows.length + i + 1}`, ...r }));
      this.client.tables[this.entry.table] = [...rows, ...withIds];
      return this.finish(withIds);
    }

    let matched = rows.filter((r) => this.matches(r));

    if (this.entry.op === "update") {
      matched = matched.map((r) => Object.assign(r, this.entry.payload as FakeRow));
      return this.finish(matched);
    }
    if (this.entry.op === "delete") {
      this.client.tables[this.entry.table] = rows.filter((r) => !this.matches(r));
      return this.finish(matched);
    }

    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      matched = [...matched].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
    }
    if (this.entry.limit !== undefined) matched = matched.slice(0, this.entry.limit);
    if (this.entry.head) return { data: null, error: null, count: matched.length };
    return this.finish(matched);
  }

  private finish(rows: FakeRow[]): { data: any; error: FakeError | null; count?: number | null } {
    const count = this.countMode ? rows.length : undefined;
    if (this.singleMode === "single") {
      if (rows.length !== 1) return { data: null, error: { message: `single() expected exactly one row, got ${rows.length}`, code: "PGRST116" }, count };
      return { data: rows[0], error: null, count };
    }
    if (this.singleMode === "maybeSingle") return { data: rows[0] ?? null, error: null, count };
    return { data: rows, error: null, count };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: FakeError | null; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

/** Cast helper so a FakeSupabaseClient can be handed to code typed against SupabaseClient. */
export function asSupabase(client: FakeSupabaseClient): any {
  return client;
}

/** A spy-wrapped client for tests that just need to count `from()` calls. */
export function spyClient(client: FakeSupabaseClient) {
  const from = vi.spyOn(client, "from");
  return { client, from };
}
