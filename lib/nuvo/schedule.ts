import { SCHEDULE } from "./config";
import type { Week } from "./types";

// Brief 1: the week is fixed in Eastern Time — subscriptions from Monday's open
// to Thursday 4:00 PM ET, expiry Friday 4:00 PM ET. Everything below works in ET
// wall clock and converts to instants, so DST changes do not shift the deadlines.

const TZ = SCHEDULE.timeZone;

const partsOf = (ts: number) => {
  const dtf = new Intl.DateTimeFormat("en-US", {
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
  const parts = Object.fromEntries(dtf.formatToParts(ts).map((p) => [p.type, p.value]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdays.indexOf(String(parts.weekday)),
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
  const thursday = addDays(monday, 3);
  const friday = addDays(monday, 4);

  const opensAt = fromEt(
    monday.year,
    monday.month,
    monday.day,
    SCHEDULE.opensAt.hour,
    SCHEDULE.opensAt.minute,
  );
  const closesAt = fromEt(
    thursday.year,
    thursday.month,
    thursday.day,
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
    opensAt,
    closesAt,
    expiresAt,
    isOpen: now >= opensAt && now < closesAt,
  };
};

/** The week that is on offer right now. Past Friday's expiry, the next one. */
export function currentWeek(now: number = Date.now()): Week {
  const p = partsOf(now);
  // Sunday counts as the week that is about to open.
  const daysSinceMonday = (p.weekday + 6) % 7;
  let monday = addDays(p, -daysSinceMonday);
  let week = weekFromMonday(monday, now);
  if (now >= week.expiresAt) {
    monday = addDays(monday, 7);
    week = weekFromMonday(monday, now);
  }
  return week;
}

export const nextWeek = (from: Week) =>
  weekFromMonday(addDays(fromIso(from.id), 7), from.expiresAt + 1);

const fromIso = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
};

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
