import { describe, expect, it } from "vitest";

import { addDaysIso, dateRangeToTimestamps, dueTone, formatDueDate, isOverdue, nowInTimezone } from "@/lib/dates";

describe("isOverdue", () => {
  const today = "2026-10-17";
  it("is overdue when the due date has passed and the task isn't done", () => {
    expect(isOverdue({ status: "todo", due_date: "2026-10-16" }, today, "09:00")).toBe(true);
    expect(isOverdue({ status: "done", due_date: "2026-10-16" }, today, "09:00")).toBe(false);
  });
  it("considers the due time on the due date", () => {
    expect(isOverdue({ status: "todo", due_date: today, due_time: "08:30:00" }, today, "09:00")).toBe(true);
    expect(isOverdue({ status: "todo", due_date: today, due_time: "17:00:00" }, today, "09:00")).toBe(false);
    expect(isOverdue({ status: "todo", due_date: today, due_time: null }, today, "23:59")).toBe(false);
  });
  it("is never overdue without a due date", () => {
    expect(isOverdue({ status: "todo", due_date: null }, today, "09:00")).toBe(false);
  });
});

describe("dueTone", () => {
  const today = "2026-10-17";
  it("classifies deadlines", () => {
    expect(dueTone({ status: "todo", due_date: "2026-10-10" }, today, "09:00")).toBe("overdue");
    expect(dueTone({ status: "todo", due_date: today }, today, "09:00")).toBe("today");
    expect(dueTone({ status: "todo", due_date: "2026-10-19" }, today, "09:00")).toBe("soon");
    expect(dueTone({ status: "todo", due_date: "2026-11-30" }, today, "09:00")).toBe("later");
    expect(dueTone({ status: "done", due_date: "2026-10-10" }, today, "09:00")).toBe("done");
    expect(dueTone({ status: "todo", due_date: null }, today, "09:00")).toBe("none");
  });
});

describe("formatting and ranges", () => {
  it("formats relative due dates", () => {
    expect(formatDueDate("2026-10-17", null, "2026-10-17")).toBe("Today");
    expect(formatDueDate("2026-10-18", "14:30:00", "2026-10-17")).toBe("Tomorrow, 14:30");
    expect(formatDueDate("2027-01-05", null, "2026-10-17")).toBe("5 Jan 2027");
  });

  it("adds days across month boundaries", () => {
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("computes 'today' in the workspace timezone, not the server's", () => {
    const instant = new Date("2026-10-17T20:00:00Z"); // 01:30 next day in Kolkata
    expect(nowInTimezone("Asia/Kolkata", instant)).toEqual({ today: "2026-10-18", time: "01:30" });
    expect(nowInTimezone("America/New_York", instant)).toEqual({ today: "2026-10-17", time: "16:00" });
  });

  it("turns a date range into UTC timestamps for the workspace timezone", () => {
    const { fromTs, toTs } = dateRangeToTimestamps("2026-10-01", "2026-10-31", "Asia/Kolkata");
    expect(fromTs).toBe("2026-09-30T18:30:00.000Z");
    expect(toTs).toBe("2026-10-31T18:30:00.000Z");
  });
});
