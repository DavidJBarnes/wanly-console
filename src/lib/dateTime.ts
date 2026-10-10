/**
 * "Oct 9, 2:14 PM" -- a date AND a time, in the viewer's own zone and locale. The year only
 * when it is not this year. Run cards used to say just "2:14 PM", which on a page of runs
 * spanning weeks said nothing about which day (David, 2026-10-10).
 */
export function dateTimeLabel(when: string | number | Date, now: Date = new Date()): string {
  const d = when instanceof Date ? when : new Date(when);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleString([], opts);
}

/** Just the time -- for the END of a span that started the same day ("Oct 9, 1:02–2:14 PM"). */
export function timeLabel(when: string | number | Date): string {
  const d = when instanceof Date ? when : new Date(when);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function sameDay(a: string | number | Date, b: string | number | Date): boolean {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth()
    && x.getDate() === y.getDate();
}

/** "Oct 9, 1:02 PM–2:14 PM" or "Oct 9, 11:40 PM–Oct 10, 1:05 AM". */
export function spanLabel(start: string | number | Date, end: string | number | Date): string {
  return `${dateTimeLabel(start)}–${sameDay(start, end) ? timeLabel(end) : dateTimeLabel(end)}`;
}
