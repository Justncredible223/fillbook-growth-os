/**
 * Single source of truth for when each of the four collection workflows
 * (X prospecting, X inbound, Reddit prospecting, Reddit inbound) runs, plus
 * the timezone they're expressed in. Nothing else in the codebase should
 * hard-code a run time or timezone -- read it from here so the operating
 * schedule lives in exactly one place.
 *
 * Approved operating model (2026-09-04):
 *   X prospecting        3x/day  08:00, 13:00, 18:00 (local)
 *   X inbound            3x/day  08:00, 13:00, 18:00 (local)
 *   Reddit prospecting   1x/day  09:00 (local)
 *   Reddit inbound       3x/day  08:00, 13:00, 18:00 (local)
 *   Anthropic auto-draft 1x/day  unchanged -- see api/daily-pipeline.ts's
 *                                 existing "0 13 * * *" Vercel Cron entry,
 *                                 preserved as-is per the spec's own
 *                                 instruction not to move it without a
 *                                 concrete reason.
 *
 * Default timezone is America/Phoenix, which -- unusually for a US zone --
 * never observes DST (Arizona does not spring forward/fall back). That
 * matters for HOW this module converts a local run time to a UTC hour:
 * rather than hardcoding "Phoenix is always UTC-7" (true today, but a
 * brittle assumption to bake into code whose timezone is meant to be
 * configurable -- a future SCHEDULE_TIMEZONE override could easily be a
 * zone that DOES observe DST), utcHourForLocalTime() below asks the
 * platform's Intl API what UTC hour a given local wall-clock time falls on
 * for a SPECIFIC calendar date. That's correct for Phoenix (where the
 * answer never changes across the year) and equally correct for any other
 * IANA zone a future config change might select, without this file needing
 * to know in advance which case it's in.
 */

export const DEFAULT_SCHEDULE_TIMEZONE = "America/Phoenix";

/** The IANA timezone every workflow's local run times below are expressed in. Override with SCHEDULE_TIMEZONE. */
export function getScheduleTimezone(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.SCHEDULE_TIMEZONE?.trim();
  if (!raw) return DEFAULT_SCHEDULE_TIMEZONE;
  // Fail fast on a typo'd zone name rather than silently falling back to
  // UTC deep inside Intl -- Intl.DateTimeFormat throws RangeError for an
  // unknown timeZone, which is exactly the useful-error behavior we want.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
  } catch {
    throw new Error(`SCHEDULE_TIMEZONE "${raw}" is not a valid IANA timezone name.`);
  }
  return raw;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseTimes(raw: string | undefined, fallback: string[], varName: string): string[] {
  if (!raw || !raw.trim()) return fallback;
  const times = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const t of times) {
    if (!HHMM.test(t)) {
      throw new Error(`${varName}="${raw}" contains an invalid time "${t}" -- expected 24h "HH:MM", comma-separated.`);
    }
  }
  return times.length > 0 ? times : fallback;
}

/** Local "HH:MM" run times for X prospecting/discovery. Override with X_PROSPECTING_TIMES (comma-separated). */
export function getXProspectingSchedule(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseTimes(env.X_PROSPECTING_TIMES, ["08:00", "13:00", "18:00"], "X_PROSPECTING_TIMES");
}

/** Local "HH:MM" run times for X inbound mentions/replies. Override with X_INBOUND_TIMES. */
export function getXInboundSchedule(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseTimes(env.X_INBOUND_TIMES, ["08:00", "13:00", "18:00"], "X_INBOUND_TIMES");
}

/** Local "HH:MM" run times for Reddit prospecting/discovery. Override with REDDIT_PROSPECTING_TIMES. Stays 1x/day per the approved spec -- do not add entries here to increase frequency without an explicit, approved spec change. */
export function getRedditProspectingSchedule(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseTimes(env.REDDIT_PROSPECTING_TIMES, ["09:00"], "REDDIT_PROSPECTING_TIMES");
}

/** Local "HH:MM" run times for Reddit inbound replies/mentions. Override with REDDIT_INBOUND_TIMES. */
export function getRedditInboundSchedule(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseTimes(env.REDDIT_INBOUND_TIMES, ["08:00", "13:00", "18:00"], "REDDIT_INBOUND_TIMES");
}

/**
 * The UTC hour (0-23) that local wall-clock time `localTime` ("HH:MM")
 * falls on for the UTC calendar day containing `onDate`, in `timezone`.
 * Computed by asking Intl.DateTimeFormat what local time each UTC hour in
 * a +/- window around `onDate` corresponds to, rather than applying a
 * fixed offset -- see this module's doc comment for why that matters.
 */
export function utcHourForLocalTime(localTime: string, timezone: string, onDate: Date): number {
  const match = HHMM.exec(localTime);
  if (!match) throw new Error(`Invalid local time "${localTime}" -- expected "HH:MM".`);
  const targetHour = Number(localTime.slice(0, 2));
  const targetMinute = Number(localTime.slice(3, 5));

  const dayStartUtc = Date.UTC(onDate.getUTCFullYear(), onDate.getUTCMonth(), onDate.getUTCDate());
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // A timezone offset is never more than +/-14h from UTC, so scanning a
  // 48h window centered on onDate's UTC day is always wide enough to find
  // an exact HH:MM match, including for zones behind UTC (need hours from
  // "yesterday UTC") or ahead of it (need hours from "tomorrow UTC").
  for (let offsetHour = -24; offsetHour < 24; offsetHour++) {
    const candidate = new Date(dayStartUtc + offsetHour * 3_600_000);
    const parts = formatter.formatToParts(candidate);
    const hourPart = parts.find((p) => p.type === "hour")?.value;
    const minutePart = parts.find((p) => p.type === "minute")?.value;
    // hour12:false can format midnight as "24" in some locale data --
    // normalize before comparing.
    const localHour = Number(hourPart) % 24;
    const localMinute = Number(minutePart);
    if (localHour === targetHour && localMinute === targetMinute) {
      return ((candidate.getUTCHours() % 24) + 24) % 24;
    }
  }
  throw new Error(`Could not resolve local time "${localTime}" in timezone "${timezone}" for ${onDate.toISOString()}.`);
}

/**
 * Which of `localTimes` a run at `now` belongs to -- nearest by wall-clock
 * distance in UTC hours (wrapping midnight), not an exact match, since a
 * real scheduler (Vercel Cron or GitHub Actions) is never perfectly on the
 * second. Recomputes each configured local time's UTC hour for `now`'s
 * calendar date on every call, so this stays correct even for a
 * DST-observing zone across a transition -- nothing here caches a
 * once-computed offset.
 */
export function currentScheduleSlot(localTimes: string[], timezone: string, now: Date): number {
  if (localTimes.length === 0) return 0;
  const utcHours = localTimes.map((t) => utcHourForLocalTime(t, timezone, now));
  const hour = now.getUTCHours();
  let bestSlot = 0;
  let bestDistance = 25;
  utcHours.forEach((runHour, slot) => {
    const raw = Math.abs(hour - runHour);
    const distance = Math.min(raw, 24 - raw);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSlot = slot;
    }
  });
  return bestSlot;
}

/**
 * True if `now` (in UTC hours) falls within `toleranceHours` of any of
 * `localTimes` converted to UTC for `now`'s calendar date. Useful for
 * wall-clock-based "is this the right window for a once/day step nested
 * inside a more-frequent invocation" checks. NOT used by
 * api/growth-pulse.ts today -- that endpoint's X/Reddit step groups are
 * gated by explicit query flags the caller
 * (.github/workflows/growth-pulse.yml) sets instead (see growth-pulse.ts's
 * own doc comment for why explicit flags won over wall-clock inference
 * there). Kept here, tested, and exported as a general-purpose scheduling
 * utility for any future caller that DOES want wall-clock-based gating.
 */
export function isWithinScheduleWindow(localTimes: string[], timezone: string, now: Date, toleranceHours = 1): boolean {
  if (localTimes.length === 0) return false;
  const hour = now.getUTCHours();
  return localTimes.some((t) => {
    const runHour = utcHourForLocalTime(t, timezone, now);
    const raw = Math.abs(hour - runHour);
    return Math.min(raw, 24 - raw) <= toleranceHours;
  });
}
