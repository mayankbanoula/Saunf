import { TZDate } from "@date-fns/tz";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

/** Today's date (YYYY-MM-DD) and wall-clock time (HH:mm) in a timezone. */
export function nowInTimezone(timezone: string, now: Date = new Date()) {
  const zoned = new TZDate(now, timezone);
  return { today: format(zoned, "yyyy-MM-dd"), time: format(zoned, "HH:mm") };
}

export function addDaysIso(isoDate: string, days: number) {
  return format(addDays(parseISO(isoDate), days), "yyyy-MM-dd");
}

/** A task is overdue when it isn't done and its due date/time has passed (workspace time). */
export function isOverdue(
  task: { status: string; due_date: string | null; due_time?: string | null },
  today: string,
  nowTime: string,
) {
  if (task.status === "done" || !task.due_date) return false;
  if (task.due_date < today) return true;
  return task.due_date === today && !!task.due_time && task.due_time.slice(0, 5) < nowTime;
}

export type DueTone = "overdue" | "today" | "soon" | "later" | "none" | "done";

export function dueTone(
  task: { status: string; due_date: string | null; due_time?: string | null },
  today: string,
  nowTime: string,
): DueTone {
  if (!task.due_date) return "none";
  if (task.status === "done") return "done";
  if (isOverdue(task, today, nowTime)) return "overdue";
  if (task.due_date === today) return "today";
  const days = differenceInCalendarDays(parseISO(task.due_date), parseISO(today));
  return days <= 3 ? "soon" : "later";
}

/** Human label for a date-only value (no timezone conversion: it is a calendar date). */
export function formatDueDate(dueDate: string, dueTime?: string | null, today?: string) {
  const d = parseISO(dueDate);
  let label: string;
  if (today) {
    const diff = differenceInCalendarDays(d, parseISO(today));
    if (diff === 0) label = "Today";
    else if (diff === 1) label = "Tomorrow";
    else if (diff === -1) label = "Yesterday";
    else label = format(d, d.getFullYear() === parseISO(today).getFullYear() ? "d MMM" : "d MMM yyyy");
  } else {
    label = format(d, "d MMM yyyy");
  }
  return dueTime ? `${label}, ${dueTime.slice(0, 5)}` : label;
}

/** Inclusive start / exclusive end ISO timestamps for a YYYY-MM-DD range in a timezone. */
export function dateRangeToTimestamps(from: string, to: string, timezone: string) {
  const start = new TZDate(`${from}T00:00:00`, timezone);
  const end = new TZDate(`${addDaysIso(to, 1)}T00:00:00`, timezone);
  return { fromTs: start.toISOString(), toTs: end.toISOString() };
}
