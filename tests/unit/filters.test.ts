import { describe, expect, it } from "vitest";

import { activeFilterCount, filtersToSearchParams, parseTaskFilters, sortDirection } from "@/lib/tasks/filters";

describe("parseTaskFilters", () => {
  it("applies defaults", () => {
    const f = parseTaskFilters({});
    expect(f.sort).toBe("updated");
    expect(f.view).toBe("list");
    expect(f.page).toBe(1);
    expect(f.status).toEqual([]);
  });

  it("parses multi-value status/priority and drops unknown values", () => {
    const f = parseTaskFilters({ status: "todo,done,bogus", priority: "urgent,meh" });
    expect(f.status).toEqual(["todo", "done"]);
    expect(f.priority).toEqual(["urgent"]);
  });

  it("rejects malformed ids and dates instead of passing them to the database", () => {
    const f = parseTaskFilters({
      assignee: "not-a-uuid'; drop table",
      project: "x",
      due_from: "2026-13-99x",
      page: "-4",
    });
    expect(f.assignee).toBeUndefined();
    expect(f.project).toBeUndefined();
    expect(f.due_from).toBeUndefined();
    expect(f.page).toBe(1);
  });

  it("accepts keywords for assignee/creator", () => {
    expect(parseTaskFilters({ assignee: "me" }).assignee).toBe("me");
    expect(parseTaskFilters({ assignee: "none" }).assignee).toBe("none");
    expect(parseTaskFilters({ creator: "me" }).creator).toBe("me");
  });

  it("lets page-level overrides win over the URL", () => {
    const f = parseTaskFilters({ assignee: "none" }, { assignee: "me" });
    expect(f.assignee).toBe("me");
  });

  it("uses the first value when a param is repeated", () => {
    expect(parseTaskFilters({ sort: ["due", "key"] }).sort).toBe("due");
  });
});

describe("sorting and serialisation", () => {
  it("defaults due-date sort to ascending and others to descending", () => {
    expect(sortDirection(parseTaskFilters({ sort: "due" }))).toBe("asc");
    expect(sortDirection(parseTaskFilters({ sort: "priority" }))).toBe("desc");
    expect(sortDirection(parseTaskFilters({ sort: "priority", dir: "asc" }))).toBe("asc");
  });

  it("round-trips filters through the URL without defaults", () => {
    const f = parseTaskFilters({ status: "todo,in_review", q: "report", sort: "updated", page: "1" });
    const sp = filtersToSearchParams(f);
    expect(sp.get("status")).toBe("todo,in_review");
    expect(sp.get("q")).toBe("report");
    expect(sp.has("sort")).toBe(false);
    expect(sp.has("page")).toBe(false);
    expect(parseTaskFilters(Object.fromEntries(sp))).toMatchObject({ status: ["todo", "in_review"], q: "report" });
  });

  it("counts active filters", () => {
    expect(activeFilterCount(parseTaskFilters({}))).toBe(0);
    expect(activeFilterCount(parseTaskFilters({ q: "x", status: "todo", due: "overdue" }))).toBe(3);
  });
});
