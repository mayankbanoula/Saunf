import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/actions";
import { escapeLike, initials, pgrstQuote } from "@/lib/utils";
import { domainListSchema, inviteSchema, settingsSchema } from "@/lib/validation/admin";
import { projectSchema } from "@/lib/validation/project";
import { bulkUpdateSchema, commentSchema, createTaskSchema, updateTaskSchema } from "@/lib/validation/task";

describe("task validation", () => {
  it("requires a title", () => {
    expect(createTaskSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "Ship it" }).success).toBe(true);
  });

  it("rejects a due date before the start date", () => {
    const r = createTaskSchema.safeParse({ title: "x", start_date: "2026-10-20", due_date: "2026-10-19" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["due_date"]);
  });

  it("requires a due date when a due time is set", () => {
    expect(createTaskSchema.safeParse({ title: "x", due_time: "10:00" }).success).toBe(false);
  });

  it("keeps progress within 0–100", () => {
    expect(updateTaskSchema.safeParse({ progress: 101 }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ progress: -1 }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ progress: "40" }).data).toEqual({ progress: 40 });
  });

  it("turns empty form strings into nulls", () => {
    const r = createTaskSchema.parse({ title: "x", assignee_id: "", due_date: "", estimate_hours: "" });
    expect(r).toMatchObject({ assignee_id: null, due_date: null, estimate_hours: null });
  });

  it("rejects invalid statuses and ids", () => {
    expect(updateTaskSchema.safeParse({ status: "blocked" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", assignee_id: "1 or 1=1" }).success).toBe(false);
  });

  it("bulk updates need at least one field and at most 200 tasks", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(bulkUpdateSchema.safeParse({ task_ids: [id], patch: {} }).success).toBe(false);
    expect(bulkUpdateSchema.safeParse({ task_ids: Array(201).fill(id), patch: { status: "done" } }).success).toBe(
      false,
    );
    expect(bulkUpdateSchema.safeParse({ task_ids: [id], patch: { archived: true } }).success).toBe(true);
  });

  it("comments must have content", () => {
    expect(commentSchema.safeParse({ task_id: "00000000-0000-4000-8000-000000000000", body: "  " }).success).toBe(
      false,
    );
  });
});

describe("admin and project validation", () => {
  it("requires a temporary password only for admin-created accounts", () => {
    const base = { email: "A@B.co ", full_name: "A", role: "employee" as const };
    expect(inviteSchema.safeParse({ ...base, mode: "invite" }).data?.email).toBe("a@b.co");
    expect(inviteSchema.safeParse({ ...base, mode: "password", password: "short" }).success).toBe(false);
    expect(inviteSchema.safeParse({ ...base, mode: "password", password: "long-enough" }).success).toBe(true);
  });

  it("does not allow 'done' as the default status", () => {
    const s = {
      workspace_name: "W",
      employees_can_create_tasks: true,
      assignment_policy: "anyone",
      task_visibility: "all",
      default_priority: "medium",
      timezone: "UTC",
      due_soon_hours: 24,
      due_reminders_enabled: true,
      email_notifications_enabled: false,
      auto_archive_done_after_days: "",
      self_signup_enabled: true,
      signup_allowed_domains: "",
      signup_requires_approval: false,
    };
    expect(settingsSchema.safeParse({ ...s, default_status: "done" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...s, default_status: "todo" }).success).toBe(true);
  });

  it("parses the sign-up domain list", () => {
    expect(domainListSchema.parse(" Acme.com, @acme.in;acme.com ")).toEqual(["acme.com", "acme.in"]);
    expect(domainListSchema.parse("")).toEqual([]);
    expect(domainListSchema.safeParse("acme").success).toBe(false);
    expect(domainListSchema.safeParse("acme.com, not a domain").success).toBe(false);
  });

  it("rejects a project target date before its start", () => {
    expect(projectSchema.safeParse({ name: "P", start_date: "2026-10-10", target_date: "2026-10-01" }).success).toBe(
      false,
    );
  });
});

describe("helpers", () => {
  it("only allows same-site relative redirects", () => {
    expect(safeNextPath("/tasks?x=1")).toBe("/tasks?x=1");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
  });

  it("escapes LIKE wildcards and PostgREST filter syntax", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(pgrstQuote('a,b)"c')).toBe('"a,b)\\"c"');
  });

  it("derives initials", () => {
    expect(initials("Ananya Rao")).toBe("AR");
    expect(initials("  ")).toBe("?");
  });
});
