import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  currentScheduleSlot,
  getOperatingDate,
  getRedditInboundSchedule,
  getRedditProspectingSchedule,
  getScheduleTimezone,
  getXInboundSchedule,
  getXProspectingSchedule,
  isWithinScheduleWindow,
  utcHourForLocalTime,
} from "../src/config/scheduleConfig";

describe("getScheduleTimezone", () => {
  it("defaults to America/Phoenix", () => {
    expect(getScheduleTimezone({})).toBe(DEFAULT_SCHEDULE_TIMEZONE);
    expect(DEFAULT_SCHEDULE_TIMEZONE).toBe("America/Phoenix");
  });

  it("honors SCHEDULE_TIMEZONE override", () => {
    expect(getScheduleTimezone({ SCHEDULE_TIMEZONE: "America/New_York" })).toBe("America/New_York");
  });

  it("rejects an invalid IANA zone name with a useful error, not a silent UTC fallback", () => {
    expect(() => getScheduleTimezone({ SCHEDULE_TIMEZONE: "Not/AZone" })).toThrow(/not a valid IANA timezone/);
  });
});

describe("default workflow schedules -- approved cadence", () => {
  it("X prospecting is 3x/day at 08:00/13:00/18:00", () => {
    expect(getXProspectingSchedule({})).toEqual(["08:00", "13:00", "18:00"]);
  });
  it("X inbound is 3x/day at 08:00/13:00/18:00", () => {
    expect(getXInboundSchedule({})).toEqual(["08:00", "13:00", "18:00"]);
  });
  it("Reddit prospecting is 1x/day at 09:00", () => {
    expect(getRedditProspectingSchedule({})).toEqual(["09:00"]);
  });
  it("Reddit inbound is 3x/day at 08:00/13:00/18:00", () => {
    expect(getRedditInboundSchedule({})).toEqual(["08:00", "13:00", "18:00"]);
  });

  it("rejects a malformed override instead of silently ignoring it", () => {
    expect(() => getXProspectingSchedule({ X_PROSPECTING_TIMES: "8am,13:00" })).toThrow(/invalid time/);
  });

  it("honors a valid comma-separated override", () => {
    expect(getRedditProspectingSchedule({ REDDIT_PROSPECTING_TIMES: "07:30,19:15" })).toEqual(["07:30", "19:15"]);
  });
});

describe("utcHourForLocalTime -- America/Phoenix (no DST)", () => {
  // Real-world verification: America/Phoenix is fixed at UTC-7 year-round.
  // Checking both a winter date and a summer date proves this module
  // doesn't accidentally assume/derive a seasonal DST shift for a zone
  // that has none -- both should resolve to the identical UTC hour.
  it("08:00 Phoenix is 15:00 UTC in January (winter)", () => {
    expect(utcHourForLocalTime("08:00", "America/Phoenix", new Date("2026-01-15T00:00:00Z"))).toBe(15);
  });
  it("08:00 Phoenix is STILL 15:00 UTC in July (summer) -- no DST drift", () => {
    expect(utcHourForLocalTime("08:00", "America/Phoenix", new Date("2026-07-15T00:00:00Z"))).toBe(15);
  });
  it("13:00 Phoenix is 20:00 UTC", () => {
    expect(utcHourForLocalTime("13:00", "America/Phoenix", new Date("2026-09-04T00:00:00Z"))).toBe(20);
  });
  it("18:00 Phoenix is 01:00 UTC (next calendar day)", () => {
    expect(utcHourForLocalTime("18:00", "America/Phoenix", new Date("2026-09-04T00:00:00Z"))).toBe(1);
  });
});

describe("utcHourForLocalTime -- a DST-observing zone, to prove this module doesn't hardcode Phoenix's lack of DST", () => {
  it("09:00 America/New_York is 13:00 UTC in July (EDT, UTC-4)", () => {
    expect(utcHourForLocalTime("09:00", "America/New_York", new Date("2026-07-15T00:00:00Z"))).toBe(13);
  });
  it("09:00 America/New_York is 14:00 UTC in January (EST, UTC-5) -- correctly different from the summer case", () => {
    expect(utcHourForLocalTime("09:00", "America/New_York", new Date("2026-01-15T00:00:00Z"))).toBe(14);
  });
});

describe("currentScheduleSlot", () => {
  const schedule = ["08:00", "13:00", "18:00"];
  const tz = "America/Phoenix";

  it("picks the nearest slot to the exact configured UTC hour", () => {
    expect(currentScheduleSlot(schedule, tz, new Date("2026-09-04T15:00:00Z"))).toBe(0); // 08:00 Phoenix
    expect(currentScheduleSlot(schedule, tz, new Date("2026-09-04T20:00:00Z"))).toBe(1); // 13:00 Phoenix
    expect(currentScheduleSlot(schedule, tz, new Date("2026-09-04T01:00:00Z"))).toBe(2); // 18:00 Phoenix
  });

  it("tolerates a few minutes/an hour of scheduler jitter without miscounting the slot", () => {
    expect(currentScheduleSlot(schedule, tz, new Date("2026-09-04T15:07:00Z"))).toBe(0);
    expect(currentScheduleSlot(schedule, tz, new Date("2026-09-04T19:50:00Z"))).toBe(1);
  });
});

describe("isWithinScheduleWindow", () => {
  const schedule = ["09:00"]; // Reddit prospecting default
  const tz = "America/Phoenix"; // 09:00 Phoenix == 16:00 UTC

  it("is true exactly at the configured UTC hour", () => {
    expect(isWithinScheduleWindow(schedule, tz, new Date("2026-09-04T16:00:00Z"))).toBe(true);
  });
  it("is true within the default 1h tolerance", () => {
    expect(isWithinScheduleWindow(schedule, tz, new Date("2026-09-04T15:05:00Z"))).toBe(true);
    expect(isWithinScheduleWindow(schedule, tz, new Date("2026-09-04T17:00:00Z"))).toBe(true);
  });
  it("is false outside the tolerance", () => {
    expect(isWithinScheduleWindow(schedule, tz, new Date("2026-09-04T13:00:00Z"))).toBe(false);
  });
  it("respects a custom tolerance", () => {
    expect(isWithinScheduleWindow(schedule, tz, new Date("2026-09-04T15:05:00Z"), 0)).toBe(false);
  });
});

describe("getOperatingDate -- the operating-day key every once-per-day feature should use instead of a raw UTC date slice", () => {
  const tz = "America/Phoenix"; // fixed UTC-7, no DST

  it("an instant early in the UTC day is still the PREVIOUS Phoenix calendar day (the exact bug this replaces: UTC-midnight slicing read this as 'today')", () => {
    // 2026-09-05T05:00:00Z is 2026-09-04T22:00:00 in Phoenix -- still Sep 4 there.
    expect(getOperatingDate(new Date("2026-09-05T05:00:00Z"), tz)).toBe("2026-09-04");
  });

  it("an instant late in the UTC day is the SAME Phoenix calendar day", () => {
    // 2026-09-04T15:00:00Z is 2026-09-04T08:00:00 in Phoenix.
    expect(getOperatingDate(new Date("2026-09-04T15:00:00Z"), tz)).toBe("2026-09-04");
  });

  it("matches the plain UTC date only well into the UTC day (after Phoenix's own midnight, 07:00 UTC)", () => {
    expect(getOperatingDate(new Date("2026-09-04T00:00:00Z"), tz)).toBe("2026-09-03"); // UTC midnight is still Sep 3 in Phoenix
    expect(getOperatingDate(new Date("2026-09-04T07:00:00Z"), tz)).toBe("2026-09-04"); // Phoenix midnight
    expect(getOperatingDate(new Date("2026-09-04T06:59:00Z"), tz)).toBe("2026-09-03"); // one minute before Phoenix midnight
  });

  it("is correct for a DST-observing zone too, not just Phoenix", () => {
    // 2026-07-15T03:30:00Z is 2026-07-14T23:30:00 EDT (UTC-4 in summer) -- still July 14 in New York.
    expect(getOperatingDate(new Date("2026-07-15T03:30:00Z"), "America/New_York")).toBe("2026-07-14");
  });
});
