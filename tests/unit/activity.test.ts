import { describe, expect, it } from "vitest";

import { actorName, describeActivity, type ActivityEvent } from "@/lib/activity";
import { describeNotification } from "@/lib/notifications";

const ev = (event_type: string, rest: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: "1",
  event_type,
  created_at: "2026-10-17T05:00:00Z",
  old_value: null,
  new_value: null,
  metadata: {},
  actor: { id: "u", full_name: "Rahul Mehta", email: "rahul@x.com" },
  ...rest,
});

describe("describeActivity", () => {
  it("produces the timeline sentences from the spec", () => {
    expect(describeActivity(ev("task_created"))).toBe("created this task");
    expect(describeActivity(ev("task_assigned", { new_value: { assignee_name: "Rahul" } }))).toBe(
      "assigned this task to Rahul",
    );
    expect(
      describeActivity(ev("status_changed", { old_value: { status: "todo" }, new_value: { status: "in_progress" } })),
    ).toBe("changed the status from To do to In progress");
    expect(describeActivity(ev("progress_changed", { old_value: { progress: 20 }, new_value: { progress: 50 } }))).toBe(
      "updated progress from 20% to 50%",
    );
    expect(describeActivity(ev("task_completed"))).toBe("completed this task");
  });

  it("names the task when shown outside the task page", () => {
    expect(describeActivity(ev("task_completed"), "SAU-00007")).toBe("completed SAU-00007");
    expect(
      describeActivity(
        ev("priority_changed", { old_value: { priority: "low" }, new_value: { priority: "urgent" } }),
        "SAU-1",
      ),
    ).toBe("changed the priority of SAU-1 from Low to Urgent");
  });

  it("describes reassignment, deadlines and grouped edits", () => {
    expect(
      describeActivity(
        ev("task_reassigned", { old_value: { assignee_name: "Dev" }, new_value: { assignee_name: "Priya" } }),
      ),
    ).toBe("reassigned this task from Dev to Priya");
    expect(
      describeActivity(
        ev("deadline_changed", {
          old_value: { due_date: null },
          new_value: { due_date: "2026-10-20", due_time: "17:00:00" },
        }),
      ),
    ).toBe("changed the due date from no due date to 20 Oct 2026, 17:00");
    expect(
      describeActivity(ev("task_edited", { metadata: { fields: ["description", "start_date", "project"] } })),
    ).toBe("edited the description, start date and project");
  });

  it("falls back to 'System' for events without an actor", () => {
    expect(actorName(ev("task_archived", { actor: null }))).toBe("System");
  });
});

describe("describeNotification", () => {
  it("summarises notifications", () => {
    expect(
      describeNotification({
        type: "task_assigned",
        data: { key: "SAU-00001", title: "Report" },
        actor: { full_name: "Ananya", email: "" },
      }).text,
    ).toBe("Ananya assigned you SAU-00001");
    expect(describeNotification({ type: "task_overdue", data: { key: "SAU-00002" }, actor: null }).text).toBe(
      "SAU-00002 is overdue",
    );
  });
});
