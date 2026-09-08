import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import handler, { MANUAL_INGEST_SOURCES, isManualIngestSource } from "../api/ingest";

const here = dirname(fileURLToPath(import.meta.url));

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("api/ingest -- YouTube/TikTok removed, X + Search Console remain manual-only", () => {
  const originalToken = process.env.APP_API_TOKEN;

  beforeEach(() => {
    process.env.APP_API_TOKEN = "test-token";
  });
  afterEach(() => {
    process.env.APP_API_TOKEN = originalToken;
  });

  it("the manual source list is exactly x and search_console", () => {
    expect([...MANUAL_INGEST_SOURCES]).toEqual(["x", "search_console"]);
    expect(isManualIngestSource("youtube")).toBe(false);
    expect(isManualIngestSource("tiktok")).toBe(false);
    expect(isManualIngestSource("x")).toBe(true);
  });

  for (const removed of ["youtube", "tiktok"]) {
    it(`rejects source=${removed} with 400 before touching any client`, async () => {
      const res = mockRes();
      await handler({ method: "POST", headers: { authorization: "Bearer test-token" }, query: { source: removed } } as any, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Query param 'source' must be one of: x, search_console" });
    });
  }

  it("the scheduled entry points contain no path to YouTube/TikTok ingestion", () => {
    for (const file of ["daily-pipeline.ts", "growth-pulse.ts"]) {
      const source = readFileSync(join(here, "..", "api", file), "utf8");
      const imports = source.split("\n").filter((line) => line.startsWith("import "));
      expect(imports.some((line) => /youtube|tiktok/i.test(line))).toBe(false);
    }
  });
});
