import { SCHEDULE } from "./config";
import type { Week } from "./types";

// Subscriptions are open around the clock. The week on offer is the one whose
// Thursday 4:00 PM ET cutoff is still ahead, and it expires that Friday at
// 4:00 PM ET. Everything below works in ET wall clock and converts to instants,
// so DST changes do not shift the deadlines.

const TZ = SCHEDULE.timeZone;

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const partsOf = (ts: number) => {
  const parts = Object.fromEntries(PARTS.formatToParts(ts).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(String(parts.weekday)),
  };
};

/** Offset of ET from UTC at that instant, in ms (negative). */
const offsetAt = (ts: number) => {
  const p = partsOf(ts);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
};

/** Instant for an ET wall clock time. Resolved twice so DST edges settle. */
const fromEt = (year: number, month: number, day: number, hour: number, minute: number) => {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let ts = naive - offsetAt(naive);
  ts = naive - offsetAt(ts);
  return ts;
};

const addDays = (
  date: { year: number; month: number; day: number },
  days: number,
) => {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const isoOf = (d: { year: number; month: number; day: number }) =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** "Week of Sep 14–18", or "Week of Sep 29–Oct 3" across a month boundary. */
const labelOf = (
  monday: { year: number; month: number; day: number },
  friday: { year: number; month: number; day: number },
) =>
  monday.month === friday.month
    ? `Week of ${MONTHS[monday.month - 1]} ${monday.day}–${friday.day}`
    : `Week of ${MONTHS[monday.month - 1]} ${monday.day}–${MONTHS[friday.month - 1]} ${friday.day}`;

const weekFromMonday = (monday: { year: number; month: number; day: number }, now: number): Week => {
  const cutoffDay = addDays(monday, SCHEDULE.closesAt.weekday - 1);
  const friday = addDays(monday, SCHEDULE.expiresAt.weekday - 1);

  const closesAt = fromEt(
    cutoffDay.year,
    cutoffDay.month,
    cutoffDay.day,
    SCHEDULE.closesAt.hour,
    SCHEDULE.closesAt.minute,
  );
  const expiresAt = fromEt(
    friday.year,
    friday.month,
    friday.day,
    SCHEDULE.expiresAt.hour,
    SCHEDULE.expiresAt.minute,
  );

  return {
    id: isoOf(monday),
    label: labelOf(monday, friday),
    closesAt,
    expiresAt,
    isOpen: now < closesAt,
  };
};

/** The week on offer: the first whose Thursday cutoff is still ahead. */
export function currentWeek(now: number = Date.now()): Week {
  const p = partsOf(now);
  const daysSinceMonday = (p.weekday + 6) % 7;
  const monday = addDays(p, -daysSinceMonday);
  const week = weekFromMonday(monday, now);
  return now < week.closesAt ? week : weekFromMonday(addDays(monday, 7), now);
}

/**
 * US market hours in ET, Monday to Friday. Outside them the reference does not
 * move, which is not the same as a stale feed. Exchange holidays are not known here.
 */
export function isMarketOpen(now: number = Date.now()) {
  const p = partsOf(now);
  if (p.weekday < 1 || p.weekday > 5) return false;
  const minutes = p.hour * 60 + p.minute;
  const { opensAt, closesAt } = SCHEDULE.market;
  return (
    minutes >= opensAt.hour * 60 + opensAt.minute && minutes < closesAt.hour * 60 + closesAt.minute
  );
}

/** "Thu 4:00 PM ET" style label for a deadline. */
export function etLabel(ts: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(ts)
    .replace(",", "");
}

const EXPIRY = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "Fri, Sep 18, 4:00 PM" — the full date, since an expiry can be up to eight days out. */
export const expiryLabel = (ts: number) => EXPIRY.format(ts);

/** "2d 04:11:32", or "00:04:11" inside the last hour. */
export function countdown(ms: number) {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = [hours, minutes, seconds].map((n) => String(n).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${clock}` : clock;
}
