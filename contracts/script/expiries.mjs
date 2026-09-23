// Печатает отметки времени пятничных экспираций 16:00 ET для addExpiries.
// Запуск: node script/expiries.mjs 26
const weeks = Number(process.argv[2] ?? 26);
const TZ = "America/New_York";

const parts = new Intl.DateTimeFormat("en-US", {
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

const partsOf = (ts) => {
  const p = Object.fromEntries(parts.formatToParts(ts).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
};

// Смещение ET от UTC в этот момент, в миллисекундах.
const offsetAt = (ts) => {
  const p = partsOf(ts);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
};

// Момент по настенным часам ET. Разрешается дважды, чтобы края перехода на летнее время сошлись.
const fromEt = (y, m, d, hh, mm) => {
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const ts = naive - offsetAt(naive);
  return naive - offsetAt(ts);
};

const now = Date.now();
const today = partsOf(now);
const list = [];
const readable = [];
const cursor = new Date(Date.UTC(today.year, today.month - 1, today.day));

while (list.length < weeks) {
  const p = { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() };
  const ts = fromEt(p.year, p.month, p.day, 16, 0);
  if (partsOf(ts).weekday === 5 && ts > now) {
    list.push(Math.floor(ts / 1000));
    readable.push(new Date(ts).toISOString());
  }
  cursor.setUTCDate(cursor.getUTCDate() + 1);
}

console.log(`[${list.join(",")}]`);
if (process.argv.includes("--verbose")) {
  readable.forEach((iso, i) => console.error(`${list[i]}  ${iso}`));
}
