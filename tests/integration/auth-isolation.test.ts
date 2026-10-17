import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { anonClient, buildWorld, cleanup, createTask, PASSWORD, service, SUPABASE_URL } from "./helpers";

let w: Awaited<ReturnType<typeof buildWorld>>;
let taskId: string;

beforeAll(async () => {
  w = await buildWorld();
  taskId = (await createTask(w.emp1, { title: "Private payroll check", assignee_id: w.emp1.id })).id;
});
afterAll(cleanup);

describe("authentication", () => {
  it("signs in with the right password and rejects the wrong one", async () => {
    const c = anonClient();
    expect((await c.auth.signInWithPassword({ email: w.emp1.email, password: PASSWORD })).error).toBeNull();
    const bad = await anonClient().auth.signInWithPassword({ email: w.emp1.email, password: "nope-nope" });
    expect(bad.error).not.toBeNull();
  });

  it("signs out (the old session can no longer refresh)", async () => {
    const c = anonClient();
    await c.auth.signInWithPassword({ email: w.emp2.email, password: PASSWORD });
    const { data: before } = await c.auth.getSession();
    expect(before.session).not.toBeNull();
    await c.auth.signOut();
    const { data: after } = await c.auth.getSession();
    expect(after.session).toBeNull();
    const refresh = await anonClient().auth.refreshSession({ refresh_token: before.session!.refresh_token });
    expect(refresh.error).not.toBeNull();
  });

  it("gives anonymous requests no data at all", async () => {
    const anon = anonClient();
    for (const table of [
      "tasks",
      "profiles",
      "workspace_members",
      "projects",
      "activity_events",
      "notifications",
    ] as const) {
      const { data } = await anon.from(table).select("*").limit(5);
      expect(data ?? []).toEqual([]);
    }
    const { error } = await anon.rpc("create_task", { p_task: { title: "x" } });
    expect(error).not.toBeNull();
  });
});

describe("workspace isolation", () => {
  it("hides another workspace's tasks, people, projects and settings", async () => {
    const c = w.outsider.client;
    expect((await c.from("tasks").select("id").eq("id", taskId)).data).toEqual([]);
    const { data: people } = await c.from("profiles").select("id").in("id", [w.emp1.id, w.admin.id]);
    expect(people).toEqual([]);
    expect((await c.from("workspace_members").select("user_id").eq("workspace_id", w.ws)).data).toEqual([]);
    expect((await c.from("workspace_settings").select("*").eq("workspace_id", w.ws)).data).toEqual([]);
    expect((await c.from("activity_events").select("id").eq("workspace_id", w.ws)).data).toEqual([]);
  });

  it("cannot write into another workspace even with a forged workspace_id", async () => {
    const c = w.outsider.client;
    const insert = await c
      .from("tasks")
      .insert({ workspace_id: w.ws, title: "Injected", number: 1, key: "SAU-99999", creator_id: w.outsider.id });
    expect(insert.error).not.toBeNull();
    const upd = await c.rpc("update_task", { p_task_id: taskId, p_patch: { title: "hijacked" } });
    expect(upd.error).not.toBeNull();
    const comment = await c
      .from("task_comments")
      .insert({ task_id: taskId, workspace_id: w.ws, author_id: w.outsider.id, body: "hi" });
    expect(comment.error).not.toBeNull();
    const label = await c.from("labels").insert({ workspace_id: w.ws, name: "evil", created_by: w.outsider.id });
    expect(label.error).not.toBeNull();
    const { data: task } = await service.from("tasks").select("title").eq("id", taskId).single();
    expect(task!.title).toBe("Private payroll check");
  });

  it("creates tasks only in the caller's own workspace", async () => {
    const t = await createTask(w.outsider, { title: "Mine" });
    const { data } = await service.from("tasks").select("workspace_id").eq("id", t.id).single();
    expect(data!.workspace_id).toBe(w.otherWs);
  });

  it("cannot assign work to someone outside the workspace", async () => {
    const res = await w.admin.client.rpc("create_task", { p_task: { title: "x", assignee_id: w.outsider.id } });
    expect(res.error).not.toBeNull();
  });
});

describe("roles", () => {
  it("only admins can change roles, departments and activation", async () => {
    for (const u of [w.manager, w.emp1]) {
      const { data } = await u.client.from("workspace_members").update({ role: "admin" }).eq("user_id", u.id).select();
      expect(data ?? []).toEqual([]);
    }
    const { error } = await w.admin.client
      .from("workspace_members")
      .update({ department_id: w.deptB })
      .eq("user_id", w.emp1.id);
    expect(error).toBeNull();
    await w.admin.client.from("workspace_members").update({ department_id: w.deptA }).eq("user_id", w.emp1.id);
  });

  it("an admin cannot demote or deactivate themselves (no lock-out)", async () => {
    const { error } = await w.admin.client
      .from("workspace_members")
      .update({ role: "employee" })
      .eq("user_id", w.admin.id);
    expect(error?.message).toMatch(/your own role/i);
  });

  it("only admins can invite people or change workspace settings", async () => {
    const inv = await w.emp1.client.from("invitations").insert({ workspace_id: w.ws, email: "x@y.zz", role: "admin" });
    expect(inv.error).not.toBeNull();
    const mgrInv = await w.manager.client
      .from("invitations")
      .insert({ workspace_id: w.ws, email: "x@y.zz", role: "employee" });
    expect(mgrInv.error).not.toBeNull();
    const { data } = await w.manager.client
      .from("workspace_settings")
      .update({ task_visibility: "participants" })
      .eq("workspace_id", w.ws)
      .select();
    expect(data ?? []).toEqual([]);
    const ok = await w.admin.client
      .from("workspace_settings")
      .update({ due_soon_hours: 48 })
      .eq("workspace_id", w.ws)
      .select();
    expect(ok.data).toHaveLength(1);
  });

  it("employees cannot create projects or departments; managers can create projects", async () => {
    expect((await w.emp1.client.from("projects").insert({ workspace_id: w.ws, name: "Nope" })).error).not.toBeNull();
    expect(
      (await w.manager.client.from("departments").insert({ workspace_id: w.ws, name: "Nope" })).error,
    ).not.toBeNull();
    const ok = await w.manager.client
      .from("projects")
      .insert({ workspace_id: w.ws, name: "Mgr project" })
      .select("owner_id")
      .single();
    expect(ok.error).toBeNull();
    expect(ok.data!.owner_id).toBe(w.manager.id);
  });

  it("the column grants stop users editing protected profile fields", async () => {
    const { error } = await w.emp1.client.from("profiles").update({ email: "spoof@x.com" }).eq("id", w.emp1.id);
    expect(error).not.toBeNull();
    const fine = await w.emp1.client
      .from("profiles")
      .update({ job_title: "Analyst" })
      .eq("id", w.emp1.id)
      .select("job_title");
    expect(fine.data?.[0].job_title).toBe("Analyst");
    const other = await w.emp1.client.from("profiles").update({ job_title: "Hacked" }).eq("id", w.emp2.id).select();
    expect(other.data ?? []).toEqual([]);
  });
});

describe("inactive users", () => {
  it("lose access to workspace data immediately, even with a still-valid JWT", async () => {
    const { data: before } = await w.emp2.client.from("tasks").select("id").eq("id", taskId);
    expect(before).toHaveLength(1); // visibility "all": colleagues can see it
    await w.admin.client.from("workspace_members").update({ is_active: false }).eq("user_id", w.emp2.id);
    const { data: after } = await w.emp2.client.from("tasks").select("id");
    expect(after).toEqual([]);
    const { data: people } = await w.emp2.client.from("workspace_members").select("user_id").eq("workspace_id", w.ws);
    expect(people?.map((p) => p.user_id)).toEqual([w.emp2.id]); // only their own (inactive) row
    const create = await w.emp2.client.rpc("create_task", { p_task: { title: "still here?" } });
    expect(create.error).not.toBeNull();
  });

  it("cannot be assigned new work", async () => {
    const res = await w.admin.client.rpc("create_task", { p_task: { title: "for inactive", assignee_id: w.emp2.id } });
    expect(res.error?.message).toMatch(/not allowed to assign/i);
  });

  it("can be banned from signing in (what the admin panel does on deactivation)", async () => {
    await service.auth.admin.updateUserById(w.emp2.id, { ban_duration: "876000h" });
    const { error } = await anonClient().auth.signInWithPassword({ email: w.emp2.email, password: PASSWORD });
    expect(error).not.toBeNull();
    await service.auth.admin.updateUserById(w.emp2.id, { ban_duration: "none" });
    await w.admin.client.from("workspace_members").update({ is_active: true }).eq("user_id", w.emp2.id);
  });

  it("is reachable only via the local test stack", () => {
    expect(SUPABASE_URL).toMatch(/127\.0\.0\.1|localhost/);
  });
});
