import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildWorld, cleanup, createTask, service, sql, updateTask } from "./helpers";

let w: Awaited<ReturnType<typeof buildWorld>>;

beforeAll(async () => {
  w = await buildWorld();
});
afterAll(cleanup);

async function events(taskId: string) {
  const { data } = await service
    .from("activity_events")
    .select("event_type, actor_id, old_value, new_value, metadata")
    .eq("task_id", taskId)
    .order("created_at");
  return data ?? [];
}

describe("task creation", () => {
  it("creates a task with a human-readable key and server-set creator/timestamps", async () => {
    const t = await createTask(w.emp1, {
      title: "  Draft onboarding guide  ",
      creator_id: w.admin.id,
      priority: "high",
    });
    expect(t.key).toMatch(/^SAU-\d{5}$/);
    const { data } = await service.from("tasks").select("*").eq("id", t.id).single();
    expect(data!.creator_id).toBe(w.emp1.id); // forged creator ignored
    expect(data!.title).toBe("Draft onboarding guide");
    expect(data!.status).toBe("todo");
    expect(data!.department_id).toBe(w.deptA); // defaults to creator's department
    expect(new Date(data!.created_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("generates unique, sequential keys under concurrent creation", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => createTask(w.admin, { title: `Concurrent ${i}` })),
    );
    const numbers = results.map((r) => Number(r.key.split("-")[1])).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(25);
    expect(numbers.at(-1)! - numbers[0]).toBe(24);
  });

  it("requires a title and enforces date and progress rules in the database", async () => {
    expect((await w.emp1.client.rpc("create_task", { p_task: { title: "   " } })).error).not.toBeNull();
    const dates = await w.emp1.client.rpc("create_task", {
      p_task: { title: "x", start_date: "2026-10-10", due_date: "2026-10-09" },
    });
    expect(dates.error).not.toBeNull();
    const t = await createTask(w.emp1, { title: "Progress bounds" });
    expect((await updateTask(w.emp1, t.id, { progress: 101 })).error).not.toBeNull();
    expect((await updateTask(w.emp1, t.id, { progress: -5 })).error).not.toBeNull();
    expect((await updateTask(w.emp1, t.id, { due_time: "10:00" })).error).not.toBeNull(); // time without a date
  });

  it("creates labels and collaborators atomically with the task", async () => {
    const { data: label } = await w.emp1.client
      .from("labels")
      .insert({ workspace_id: w.ws, name: `lbl-${Date.now()}`, created_by: w.emp1.id })
      .select("id")
      .single();
    const t = await createTask(w.emp1, { title: "With extras" }, { labels: [label!.id], collaborators: [w.emp2.id] });
    const { data } = await service
      .from("tasks")
      .select("task_labels(label_id), task_collaborators(user_id)")
      .eq("id", t.id)
      .single();
    expect(data!.task_labels).toHaveLength(1);
    expect(data!.task_collaborators).toEqual([{ user_id: w.emp2.id }]);

    // A bad collaborator id rolls back the whole creation.
    const before = (await service.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", w.ws))
      .count;
    const bad = await w.emp1.client.rpc("create_task", {
      p_task: { title: "Atomic?" },
      p_collaborator_ids: [w.outsider.id],
    });
    expect(bad.error).not.toBeNull();
    const after = (await service.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", w.ws))
      .count;
    expect(after).toBe(before);
  });

  it("respects the 'employees can create tasks' setting", async () => {
    await w.admin.client
      .from("workspace_settings")
      .update({ employees_can_create_tasks: false })
      .eq("workspace_id", w.ws);
    expect((await w.emp1.client.rpc("create_task", { p_task: { title: "blocked" } })).error?.message).toMatch(
      /not allowed to create/i,
    );
    expect((await w.manager.client.rpc("create_task", { p_task: { title: "manager ok" } })).error).toBeNull();
    await w.admin.client
      .from("workspace_settings")
      .update({ employees_can_create_tasks: true })
      .eq("workspace_id", w.ws);
  });
});

describe("assignment policy", () => {
  async function setPolicy(policy: "anyone" | "department" | "self") {
    await w.admin.client.from("workspace_settings").update({ assignment_policy: policy }).eq("workspace_id", w.ws);
  }
  afterAll(() => setPolicy("anyone"));

  it("anyone: employees can assign any active member", async () => {
    await setPolicy("anyone");
    expect(
      (await w.emp1.client.rpc("create_task", { p_task: { title: "a", assignee_id: w.emp2.id } })).error,
    ).toBeNull();
  });

  it("department: employees can assign within their department only", async () => {
    await setPolicy("department");
    expect(
      (await w.emp1.client.rpc("create_task", { p_task: { title: "b", assignee_id: w.manager.id } })).error,
    ).toBeNull();
    expect(
      (await w.emp1.client.rpc("create_task", { p_task: { title: "c", assignee_id: w.emp2.id } })).error?.message,
    ).toMatch(/not allowed to assign/i);
  });

  it("self: employees can only assign themselves; managers are unrestricted", async () => {
    await setPolicy("self");
    expect(
      (await w.emp1.client.rpc("create_task", { p_task: { title: "d", assignee_id: w.emp1.id } })).error,
    ).toBeNull();
    expect(
      (await w.emp1.client.rpc("create_task", { p_task: { title: "e", assignee_id: w.manager.id } })).error,
    ).not.toBeNull();
    expect(
      (await w.manager.client.rpc("create_task", { p_task: { title: "f", assignee_id: w.emp2.id } })).error,
    ).toBeNull();
  });

  it("applies the policy to reassignment too", async () => {
    await setPolicy("self");
    const t = await createTask(w.emp1, { title: "Reassign me", assignee_id: w.emp1.id });
    expect((await updateTask(w.emp1, t.id, { assignee_id: w.emp2.id })).error?.message).toMatch(
      /not allowed to assign/i,
    );
  });
});

describe("assignment history", () => {
  it("records every assignment with previous/new assignee, actor, time and note", async () => {
    const t = await createTask(
      w.manager,
      { title: "Quarterly report", assignee_id: w.emp1.id },
      { note: "Esha knows the numbers" },
    );
    expect((await updateTask(w.manager, t.id, { assignee_id: w.emp2.id }, "Esha is on leave")).error).toBeNull();
    expect((await updateTask(w.emp2, t.id, { assignee_id: null }, "Handing back")).error).toBeNull();

    const { data: history } = await w.manager.client
      .from("task_assignments")
      .select("previous_assignee_id, new_assignee_id, changed_by, note, changed_at")
      .eq("task_id", t.id)
      .order("changed_at");
    expect(history).toMatchObject([
      {
        previous_assignee_id: null,
        new_assignee_id: w.emp1.id,
        changed_by: w.manager.id,
        note: "Esha knows the numbers",
      },
      {
        previous_assignee_id: w.emp1.id,
        new_assignee_id: w.emp2.id,
        changed_by: w.manager.id,
        note: "Esha is on leave",
      },
      { previous_assignee_id: w.emp2.id, new_assignee_id: null, changed_by: w.emp2.id, note: "Handing back" },
    ]);

    const { data: task } = await service
      .from("tasks")
      .select("created_at, assigned_at, assigned_by")
      .eq("id", t.id)
      .single();
    expect(task!.assigned_at).toBeNull(); // unassigned now
    expect(new Date(task!.created_at).getTime()).toBeLessThan(Date.now());
  });

  it("notifies the new assignee, but not the person who made the change", async () => {
    const t = await createTask(w.manager, { title: "Notify me", assignee_id: w.emp1.id });
    await updateTask(w.manager, t.id, { assignee_id: w.emp2.id });
    const { data: n1 } = await w.emp1.client.from("notifications").select("type").eq("task_id", t.id);
    const { data: n2 } = await w.emp2.client.from("notifications").select("type").eq("task_id", t.id);
    const { data: n3 } = await w.manager.client.from("notifications").select("type").eq("task_id", t.id);
    expect(n1?.map((n) => n.type)).toEqual(["task_assigned"]);
    expect(n2?.map((n) => n.type)).toEqual(["task_reassigned"]);
    expect(n3).toEqual([]);
  });
});

describe("status, completion and reopening", () => {
  it("completing sets progress to 100 and records who/when; reopening clears it", async () => {
    const t = await createTask(w.manager, { title: "Ship release", assignee_id: w.emp1.id });
    await updateTask(w.emp1, t.id, { status: "in_progress", progress: 40 });
    await updateTask(w.emp1, t.id, { status: "done" });
    let { data } = await service
      .from("tasks")
      .select("status, progress, completed_at, completed_by")
      .eq("id", t.id)
      .single();
    expect(data).toMatchObject({ status: "done", progress: 100, completed_by: w.emp1.id });
    expect(data!.completed_at).not.toBeNull();

    await updateTask(w.manager, t.id, { status: "in_progress" });
    ({ data } = await service
      .from("tasks")
      .select("status, progress, completed_at, completed_by")
      .eq("id", t.id)
      .single());
    expect(data).toMatchObject({ status: "in_progress", progress: 90, completed_at: null, completed_by: null });

    const types = (await events(t.id)).map((e) => e.event_type);
    expect(types).toEqual([
      "task_created",
      "task_assigned",
      "status_changed",
      "progress_changed",
      "task_completed",
      "task_reopened",
    ]);
  });

  it("keeps the blocked flag separate from the workflow status", async () => {
    const t = await createTask(w.emp1, { title: "Waiting on vendor", status: "in_progress" });
    await updateTask(w.emp1, t.id, { is_blocked: true, blocker_description: "Vendor hasn't replied" });
    const { data } = await service
      .from("tasks")
      .select("status, is_blocked, blocker_description")
      .eq("id", t.id)
      .single();
    expect(data).toEqual({ status: "in_progress", is_blocked: true, blocker_description: "Vendor hasn't replied" });
    await updateTask(w.emp1, t.id, { is_blocked: false });
    const { data: after } = await service.from("tasks").select("blocker_description").eq("id", t.id).single();
    expect(after!.blocker_description).toBeNull();
  });

  it("does not let clients overwrite server-owned fields", async () => {
    const t = await createTask(w.emp1, { title: "Immutable bits" });
    const { data: before } = await service.from("tasks").select("created_at, key, creator_id").eq("id", t.id).single();
    // Not in the column grants → rejected outright.
    expect(
      (await w.emp1.client.from("tasks").update({ created_at: "2000-01-01T00:00:00Z" }).eq("id", t.id)).error,
    ).not.toBeNull();
    expect((await w.emp1.client.from("tasks").update({ key: "SAU-00000" }).eq("id", t.id)).error).not.toBeNull();
    expect(
      (await w.emp1.client.from("tasks").update({ completed_at: new Date().toISOString() }).eq("id", t.id)).error,
    ).not.toBeNull();
    const { data: after } = await service.from("tasks").select("created_at, key, creator_id").eq("id", t.id).single();
    expect(after).toEqual(before);
  });
});

describe("field-level permissions", () => {
  it("an assignee can update work fields but not task details", async () => {
    const t = await createTask(w.manager, { title: "Manager's task", assignee_id: w.emp1.id });
    expect((await updateTask(w.emp1, t.id, { status: "in_progress", progress: 30 })).error).toBeNull();
    expect((await updateTask(w.emp1, t.id, { title: "Renamed" })).error?.message).toMatch(/permission to edit/i);
    expect((await updateTask(w.emp1, t.id, { due_date: "2030-01-01" })).error?.message).toMatch(/permission to edit/i);
    expect((await updateTask(w.emp1, t.id, { archived: true })).error).not.toBeNull();
  });

  it("an unrelated employee can see but not change a task", async () => {
    const t = await createTask(w.manager, { title: "Not yours", assignee_id: w.emp1.id });
    expect((await w.emp2.client.from("tasks").select("id").eq("id", t.id)).data).toHaveLength(1);
    expect((await updateTask(w.emp2, t.id, { status: "done" })).error).not.toBeNull();
    const direct = await w.emp2.client.from("tasks").update({ status: "done" }).eq("id", t.id).select();
    expect(direct.data ?? []).toEqual([]);
  });

  it("a manager can edit tasks in their department but not elsewhere", async () => {
    const mine = await createTask(w.emp1, { title: "Eng task" });
    const theirs = await createTask(w.emp2, { title: "Finance task" });
    expect((await updateTask(w.manager, mine.id, { priority: "urgent" })).error).toBeNull();
    expect((await updateTask(w.manager, theirs.id, { priority: "urgent" })).error).not.toBeNull();
  });
});

describe("archiving and restoring", () => {
  it("archives, blocks edits while archived, and restores", async () => {
    const t = await createTask(w.emp1, { title: "Old initiative", assignee_id: w.emp1.id });
    expect((await updateTask(w.emp1, t.id, { archived: true })).error).toBeNull();
    const { data: row } = await service.from("tasks").select("archived_at, archived_by").eq("id", t.id).single();
    expect(row!.archived_by).toBe(w.emp1.id);

    expect((await updateTask(w.emp1, t.id, { status: "done" })).error?.message).toMatch(/archived/i);
    const comment = await w.emp1.client
      .from("task_comments")
      .insert({ task_id: t.id, workspace_id: w.ws, author_id: w.emp1.id, body: "hi" });
    expect(comment.error).not.toBeNull();

    // Hidden from ordinary open views (which filter archived_at is null) but still protected by RLS.
    const { data: open } = await w.emp1.client.from("tasks").select("id").eq("id", t.id).is("archived_at", null);
    expect(open).toEqual([]);
    expect((await w.outsider.client.from("tasks").select("id").eq("id", t.id)).data).toEqual([]);

    expect((await updateTask(w.emp2, t.id, { archived: false })).error).not.toBeNull(); // not an editor
    expect((await updateTask(w.admin, t.id, { archived: false })).error).toBeNull();
    const types = (await events(t.id)).map((e) => e.event_type);
    expect(types).toContain("task_archived");
    expect(types.at(-1)).toBe("task_restored");
  });

  it("supports bulk archive within one transaction", async () => {
    const a = await createTask(w.emp1, { title: "bulk a" });
    const b = await createTask(w.manager, { title: "bulk b" });
    // emp1 isn't an editor of b → the whole batch is rejected.
    const denied = await w.emp1.client.rpc("bulk_update_tasks", {
      p_task_ids: [a.id, b.id],
      p_patch: { archived: true },
    });
    expect(denied.error).not.toBeNull();
    const { data } = await service.from("tasks").select("archived_at").eq("id", a.id).single();
    expect(data!.archived_at).toBeNull();
    const ok = await w.manager.client.rpc("bulk_update_tasks", {
      p_task_ids: [a.id, b.id],
      p_patch: { archived: true },
    });
    expect(ok.data).toBe(2);
  });
});

describe("activity timeline", () => {
  it("records a readable, ordered history with actors and before/after values", async () => {
    const t = await createTask(w.admin, {
      title: "Timeline",
      assignee_id: w.emp1.id,
      priority: "low",
      due_date: "2030-01-10",
    });
    await updateTask(w.emp1, t.id, { status: "in_progress" });
    expect(
      (await updateTask(w.admin, t.id, { priority: "urgent", due_date: "2030-01-05", title: "Timeline v2" })).error,
    ).toBeNull();
    const ev = await events(t.id);
    expect(ev.map((e) => e.event_type)).toEqual([
      "task_created",
      "task_assigned",
      "status_changed",
      "priority_changed",
      "deadline_changed",
      "task_edited",
    ]);
    expect(ev[2]).toMatchObject({
      actor_id: w.emp1.id,
      old_value: { status: "todo" },
      new_value: { status: "in_progress" },
    });
    expect(ev[3]).toMatchObject({ old_value: { priority: "low" }, new_value: { priority: "urgent" } });
    expect(ev[5]).toMatchObject({
      old_value: { title: "Timeline" },
      new_value: { title: "Timeline v2" },
      metadata: { fields: ["title"] },
    });
  });

  it("cannot be forged, edited or deleted by users", async () => {
    const t = await createTask(w.admin, { title: "Tamper" });
    const forge = await w.admin.client
      .from("activity_events")
      .insert({ workspace_id: w.ws, task_id: t.id, event_type: "task_completed" });
    expect(forge.error).not.toBeNull();
    const { data: upd } = await w.admin.client
      .from("activity_events")
      .update({ event_type: "task_restored" })
      .eq("task_id", t.id)
      .select();
    expect(upd ?? []).toEqual([]);
    const { data: del } = await w.admin.client.from("activity_events").delete().eq("task_id", t.id).select();
    expect(del ?? []).toEqual([]);
    expect((await events(t.id)).length).toBeGreaterThan(0);
  });

  it("is append-only even for the database owner", async () => {
    const t = await createTask(w.admin, { title: "Owner tamper", assignee_id: w.emp1.id });
    await expect(
      sql("update public.activity_events set event_type = 'task_restored' where task_id = $1", [t.id]),
    ).rejects.toThrow(/append-only/);
    await expect(sql("delete from public.activity_events where task_id = $1", [t.id])).rejects.toThrow(/append-only/);
    await expect(sql("delete from public.task_assignments where task_id = $1", [t.id])).rejects.toThrow(/append-only/);
  });

  it("does not store full descriptions or secrets in the log", async () => {
    const t = await createTask(w.admin, { title: "Desc", description: "first" });
    expect((await updateTask(w.admin, t.id, { description: "Secret salary figures: 123456" })).error).toBeNull();
    const ev = await events(t.id);
    expect(JSON.stringify(ev)).not.toContain("123456");
    expect(ev.at(-1)).toMatchObject({ event_type: "task_edited", metadata: { fields: ["description"] } });
  });
});

describe("dependencies and subtasks", () => {
  it("prevents dependency cycles and self-parenting", async () => {
    const a = await createTask(w.emp1, { title: "A" });
    const b = await createTask(w.emp1, { title: "B" });
    expect(
      (
        await w.emp1.client
          .from("task_dependencies")
          .insert({ task_id: b.id, depends_on_task_id: a.id, workspace_id: w.ws })
      ).error,
    ).toBeNull();
    const cycle = await w.emp1.client
      .from("task_dependencies")
      .insert({ task_id: a.id, depends_on_task_id: b.id, workspace_id: w.ws });
    expect(cycle.error?.message).toMatch(/cycle/i);
    const child = await createTask(w.emp1, { title: "Child", parent_id: a.id });
    expect((await updateTask(w.emp1, a.id, { parent_id: child.id })).error?.message).toMatch(/ancestor/i);
  });
});
