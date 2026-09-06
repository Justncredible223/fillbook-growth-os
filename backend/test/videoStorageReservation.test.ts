import { describe, it, expect } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import {
  reserveVideoStorageBytes,
  commitVideoStorageReservation,
  releaseVideoStorageReservation,
} from "../src/video/videoStorageReservation";

const CAP = 1000;

function client(overrides: Record<string, any[]> = {}) {
  return new FakeSupabaseClient({ video_storage_reservations: [], ...overrides });
}

describe("reserveVideoStorageBytes / commit / release", () => {
  it("reserves successfully when nothing has been reserved yet", async () => {
    const c = client();
    const result = await reserveVideoStorageBytes(asSupabase(c), "render-1", 400, CAP);
    expect(result.eligible).toBe(true);
    expect(result.reservationId).not.toBeNull();
    const open = c.tables.video_storage_reservations!.filter((r) => r.status === "reserved");
    expect(open).toHaveLength(1);
    expect(open[0]!.video_render_id).toBe("render-1");
  });

  it("concurrent reservations: only one fits under the cap -- the second is denied and never inserted", async () => {
    const c = client();
    const first = await reserveVideoStorageBytes(asSupabase(c), "render-1", 700, CAP);
    const second = await reserveVideoStorageBytes(asSupabase(c), "render-2", 700, CAP);
    expect(first.eligible).toBe(true);
    expect(second.eligible).toBe(false);
    expect(second.reason).toMatch(/storage_cap_reached/);
    expect(c.tables.video_storage_reservations).toHaveLength(1); // denied reservations are never inserted
  });

  it("committed AND still-open reserved rows both count against the cap -- a request that only fits if the reserved row were wrongly excluded is correctly denied", async () => {
    const c = client();
    const { reservationId } = await reserveVideoStorageBytes(asSupabase(c), "render-1", 400, CAP);
    await commitVideoStorageReservation(asSupabase(c), reservationId as string);
    // A second, still-open reservation on top of the committed one.
    await reserveVideoStorageBytes(asSupabase(c), "render-2", 400, CAP);
    // 400 committed + 400 reserved + 300 requested = 1100 > 1000 cap.
    const third = await reserveVideoStorageBytes(asSupabase(c), "render-3", 300, CAP);
    expect(third.eligible).toBe(false);
  });

  it("failed upload releases cleanly, and the freed bytes become reservable again", async () => {
    const c = client();
    const { reservationId } = await reserveVideoStorageBytes(asSupabase(c), "render-1", 700, CAP);
    await releaseVideoStorageReservation(asSupabase(c), reservationId);
    const row = c.tables.video_storage_reservations!.find((r) => r.id === reservationId);
    expect(row!.status).toBe("released");
    const retry = await reserveVideoStorageBytes(asSupabase(c), "render-1", 700, CAP);
    expect(retry.eligible).toBe(true);
  });

  it("worker death: an abandoned reservation past its expiry is swept to released by the NEXT reserve call, before that call computes its own eligibility", async () => {
    const c = client();
    const { reservationId } = await reserveVideoStorageBytes(asSupabase(c), "render-1", 700, CAP);
    // Simulate the worker crashing before commit/release ever runs, and
    // time passing well beyond the 10-minute lease.
    const row = c.tables.video_storage_reservations!.find((r) => r.id === reservationId)!;
    row.expires_at = new Date(Date.now() - 60_000).toISOString();

    // This would be denied (700 + 700 > 1000) if the abandoned reservation
    // were still counted as open -- proving the sweep runs first.
    const next = await reserveVideoStorageBytes(asSupabase(c), "render-2", 700, CAP);
    expect(next.eligible).toBe(true);
    const swept = c.tables.video_storage_reservations!.find((r) => r.id === reservationId);
    expect(swept!.status).toBe("released");
  });

  it("commit is one-way: releasing an already-committed row is a no-op", async () => {
    const c = client();
    const { reservationId } = await reserveVideoStorageBytes(asSupabase(c), "render-1", 400, CAP);
    await commitVideoStorageReservation(asSupabase(c), reservationId as string);
    await releaseVideoStorageReservation(asSupabase(c), reservationId);
    const row = c.tables.video_storage_reservations!.find((r) => r.id === reservationId);
    expect(row!.status).toBe("committed"); // unaffected by the release attempt
  });

  it("releasing a null reservationId (nothing was ever reserved) is a safe no-op", async () => {
    const c = client();
    await expect(releaseVideoStorageReservation(asSupabase(c), null)).resolves.not.toThrow();
  });
});
