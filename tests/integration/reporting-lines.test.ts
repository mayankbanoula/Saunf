import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildWorld, cleanup, createTask, createUser, updateTask } from "./helpers";

let w: Awaited<ReturnType<typeof buildWorld>>;

type Summary = { open: number };

beforeAll(async () => {
  w = await buildWorld();
});
afterAll(cleanup);

const setReportsTo = (userId: string, managerId: string | null, as = w.admin) =>
  as.client.from("workspace_members").update({ reports_to: managerId }).eq("workspace_id", w.ws).eq("user_id", userId);

describe("reporting lines", () => {
  it("only admins can set who someone reports to", async () => {
    await setReportsTo(w.emp2.id, w.manager.id, w.manager);
    const { data: unchanged } = await w.admin.client
      .from("workspace_members")
      .select("reports_to")
      .eq("user_id", w.emp2.id)
      .single();
    expect(unchanged!.reports_to).toBeNull();

    expect((await setReportsTo(w.emp2.id, w.manager.id)).error).toBeNull();
  });

  it("rejects reporting to yourself, to an employee, or in a loop", async () => {
    expect((await setReportsTo(w.manager.id, w.manager.id)).error?.message).toMatch(/themselves/);
    expect((await setReportsTo(w.emp2.id, w.emp1.id)).error?.message).toMatch(/manager or admin/);

    const senior = await createUser(w.ws, "manager", { name: "Sana Senior" });
    expect((await setReportsTo(w.manager.id, senior.id)).error).toBeNull();
    expect((await setReportsTo(senior.id, w.manager.id)).error?.message).toMatch(/loop/);

    // Managers see reportees at any depth.
    const { data: people } = await senior.client.rpc("people_in_scope");
    expect(people!.map((p) => p.user_id).sort()).toEqual([senior.id, w.manager.id, w.emp2.id].sort());
    await setReportsTo(w.manager.id, null);
  });

  it("limits activity to your own, your reportees', and tasks you work on", async () => {
    const t = await createTask(w.emp2, { title: "Quarterly close", assignee_id: w.emp2.id });
    await updateTask(w.emp2, t.id, { status: "in_progress" });

    const events = async (who: typeof w.admin) =>
      (await who.client.from("activity_events").select("id").eq("task_id", t.id)).data ?? [];
    expect(await events(w.emp2)).not.toHaveLength(0);
    expect(await events(w.manager)).not.toHaveLength(0); // emp2 reports to the manager
    expect(await events(w.admin)).not.toHaveLength(0);
    expect(await events(w.emp1)).toEqual([]); // can open the task, but not see emp2's activity

    // emp1 sees their own action on it, but still not emp2's.
    await w.emp1.client
      .from("task_comments")
      .insert({ task_id: t.id, workspace_id: w.ws, author_id: w.emp1.id, body: "Need anything?" });
    const mine = (await w.emp1.client.from("activity_events").select("actor_id").eq("task_id", t.id)).data ?? [];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.actor_id === w.emp1.id)).toBe(true);
  });

  it("scopes dashboard numbers to the viewer and their reportees", async () => {
    await createTask(w.emp1, { title: "Emp1 open task", assignee_id: w.emp1.id });
    const open = async (who: typeof w.admin, member?: string) =>
      ((await who.client.rpc("dashboard_summary", { p_member: member })).data as unknown as Summary).open;

    const emp1Own = await open(w.emp1);
    const emp2Own = await open(w.emp2);
    expect(emp1Own).toBeGreaterThan(0);
    expect(emp2Own).toBeGreaterThan(0);
    // Asking about someone outside your scope never widens it.
    expect(await open(w.emp1, w.emp2.id)).toBe(0);
    // The manager sees emp2 (reportee) and emp1 is not in their reporting line.
    expect(await open(w.manager, w.emp2.id)).toBe(emp2Own);
    expect(await open(w.manager, w.emp1.id)).toBe(0);
    expect(await open(w.admin)).toBeGreaterThanOrEqual(emp1Own + emp2Own);

    const workload = (await w.emp1.client.rpc("workload_by_member")).data ?? [];
    expect(workload.map((r) => r.user_id)).toEqual([w.emp1.id]);
  });

  it("frees reportees when their manager becomes an employee", async () => {
    await w.admin.client
      .from("workspace_members")
      .update({ role: "employee" })
      .eq("workspace_id", w.ws)
      .eq("user_id", w.manager.id);
    const { data } = await w.admin.client
      .from("workspace_members")
      .select("reports_to")
      .eq("user_id", w.emp2.id)
      .single();
    expect(data!.reports_to).toBeNull();
  });
});

describe("dashboard involvement", () => {
  it("counts tasks you created or collaborate on, not only ones assigned to you", async () => {
    const world = await buildWorld();
    const open = async (who: typeof world.emp1, member?: string) =>
      ((await who.client.rpc("dashboard_summary", { p_member: member })).data as unknown as Summary).open;

    expect(await open(world.emp2)).toBe(0);
    // emp2 creates a task for emp1 and is added as a collaborator on another of emp1's.
    await createTask(world.emp2, { title: "Created for someone else", assignee_id: world.emp1.id });
    await createTask(
      world.emp1,
      { title: "Shared work", assignee_id: world.emp1.id },
      { collaborators: [world.emp2.id] },
    );
    await createTask(world.emp1, { title: "Not emp2's business", assignee_id: world.emp1.id });
    expect(await open(world.emp2)).toBe(2);
    expect(await open(world.emp1)).toBe(3);

    const titles = async (who: typeof world.emp1) =>
      ((await who.client.rpc("tasks_in_view").select("title")).data ?? []).map((t) => t.title).sort();
    expect(await titles(world.emp2)).toEqual(["Created for someone else", "Shared work"]);

    // Activity: everything on emp2's tasks (including emp1's changes), nothing on others.
    const activity = (await world.emp2.client.rpc("activity_in_view").select("task_id")).data ?? [];
    expect(activity.length).toBeGreaterThan(0);
    const { data: hidden } = await world.admin.client
      .from("tasks")
      .select("id")
      .eq("title", "Not emp2's business")
      .single();
    expect(activity.some((e) => e.task_id === hidden!.id)).toBe(false);

    // Admins see everything; asking about someone outside your scope returns nothing.
    expect(await open(world.admin)).toBe(3);
    expect(await open(world.emp2, world.emp1.id)).toBe(0);
  });
});
