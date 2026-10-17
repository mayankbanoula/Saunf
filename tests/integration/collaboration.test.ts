import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ATTACHMENT_BUCKET } from "@/lib/tasks/constants";

import { anonClient, buildWorld, cleanup, createTask, service, sql, SUPABASE_URL, updateTask } from "./helpers";

let w: Awaited<ReturnType<typeof buildWorld>>;

beforeAll(async () => {
  w = await buildWorld();
});
afterAll(cleanup);

describe("task visibility", () => {
  afterAll(async () => {
    await w.admin.client.from("workspace_settings").update({ task_visibility: "all" }).eq("workspace_id", w.ws);
  });

  it("participants mode: employees only see tasks they're involved in; managers see their department", async () => {
    await w.admin.client
      .from("workspace_settings")
      .update({ task_visibility: "participants" })
      .eq("workspace_id", w.ws);
    const t = await createTask(w.emp1, { title: "Eng-only work", assignee_id: w.emp1.id });
    expect((await w.emp2.client.from("tasks").select("id").eq("id", t.id)).data).toEqual([]);
    expect((await w.manager.client.from("tasks").select("id").eq("id", t.id)).data).toHaveLength(1);
    expect((await w.admin.client.from("tasks").select("id").eq("id", t.id)).data).toHaveLength(1);
    // Child rows inherit task visibility.
    await w.emp1.client
      .from("task_comments")
      .insert({ task_id: t.id, workspace_id: w.ws, author_id: w.emp1.id, body: "hidden" });
    expect((await w.emp2.client.from("task_comments").select("id").eq("task_id", t.id)).data).toEqual([]);
    expect((await w.emp2.client.from("activity_events").select("id").eq("task_id", t.id)).data).toEqual([]);

    // Adding emp2 as a collaborator makes it visible to them.
    await updateTaskCollaborators(t.id, [w.emp2.id]);
    expect((await w.emp2.client.from("tasks").select("id").eq("id", t.id)).data).toHaveLength(1);
  });

  it("private projects hide their tasks from non-members, even in 'all' mode", async () => {
    await w.admin.client.from("workspace_settings").update({ task_visibility: "all" }).eq("workspace_id", w.ws);
    const { data: project } = await w.manager.client
      .from("projects")
      .insert({ workspace_id: w.ws, name: `Secret ${Date.now()}`, is_private: true })
      .select("id")
      .single();
    const t = await createTask(w.manager, { title: "Confidential", project_id: project!.id });
    expect((await w.emp2.client.from("projects").select("id").eq("id", project!.id)).data).toEqual([]);
    expect((await w.emp2.client.from("tasks").select("id").eq("id", t.id)).data).toEqual([]);
    // emp2 can't create a task in it either.
    expect(
      (await w.emp2.client.rpc("create_task", { p_task: { title: "sneak", project_id: project!.id } })).error,
    ).not.toBeNull();

    await w.manager.client
      .from("project_members")
      .insert({ project_id: project!.id, user_id: w.emp2.id, workspace_id: w.ws });
    expect((await w.emp2.client.from("tasks").select("id").eq("id", t.id)).data).toHaveLength(1);
    expect((await w.admin.client.from("projects").select("id").eq("id", project!.id)).data).toHaveLength(1);
  });

  it("only project owners/leads/admins can change a project", async () => {
    const { data: project } = await w.manager.client
      .from("projects")
      .insert({ workspace_id: w.ws, name: `Public ${Date.now()}` })
      .select("id")
      .single();
    const { data: denied } = await w.emp1.client
      .from("projects")
      .update({ name: "Renamed" })
      .eq("id", project!.id)
      .select();
    expect(denied ?? []).toEqual([]);
    const lead = await w.manager.client
      .from("project_members")
      .insert({ project_id: project!.id, user_id: w.emp1.id, workspace_id: w.ws, role: "lead" });
    expect(lead.error).toBeNull();
    const { data: allowed } = await w.emp1.client
      .from("projects")
      .update({ status: "on_hold" })
      .eq("id", project!.id)
      .select();
    expect(allowed).toHaveLength(1);
  });
});

async function updateTaskCollaborators(taskId: string, ids: string[]) {
  const { error } = await w.admin.client.rpc("update_task", { p_task_id: taskId, p_collaborator_ids: ids });
  if (error) throw error;
}

describe("comments", () => {
  it("lets viewers comment, authors edit, and admins soft-delete; others can't edit", async () => {
    const t = await createTask(w.emp1, { title: "Discuss", assignee_id: w.emp1.id });
    const { data: c, error } = await w.emp2.client
      .from("task_comments")
      .insert({ task_id: t.id, workspace_id: w.ws, author_id: w.admin.id, body: "Looks good" })
      .select("id, author_id")
      .single();
    expect(error).toBeNull();
    expect(c!.author_id).toBe(w.emp2.id); // forged author ignored

    expect(
      (await w.emp1.client.from("task_comments").update({ body: "edited by someone else" }).eq("id", c!.id).select())
        .data ?? [],
    ).toEqual([]);
    const own = await w.emp2.client
      .from("task_comments")
      .update({ body: "Looks great" })
      .eq("id", c!.id)
      .select("body, edited_at")
      .single();
    expect(own.data!.body).toBe("Looks great");
    expect(own.data!.edited_at).not.toBeNull();

    // Admins can delete (soft) but not rewrite someone else's words.
    expect(
      (await w.admin.client.from("task_comments").update({ body: "admin rewrite" }).eq("id", c!.id)).error?.message,
    ).toMatch(/only the author/i);
    const del = await w.admin.client
      .from("task_comments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", c!.id)
      .select("deleted_by");
    expect(del.data?.[0].deleted_by).toBe(w.admin.id);
    expect(
      (await w.emp2.client.from("task_comments").update({ body: "undelete?" }).eq("id", c!.id).select()).data ?? [],
    ).toEqual([]);
    expect((await w.emp2.client.from("task_comments").delete().eq("id", c!.id)).error).not.toBeNull(); // no hard delete

    const types = (await service.from("activity_events").select("event_type").eq("task_id", t.id)).data!.map(
      (e) => e.event_type,
    );
    expect(types).toEqual(expect.arrayContaining(["comment_added", "comment_edited", "comment_deleted"]));
  });

  it("notifies participants and mentioned people, filtering mentions to those who can see the task", async () => {
    const t = await createTask(w.manager, { title: "Mentions", assignee_id: w.emp1.id });
    const { data: c } = await w.emp1.client
      .from("task_comments")
      .insert({
        task_id: t.id,
        workspace_id: w.ws,
        author_id: w.emp1.id,
        body: "@Farhan can you check? @Olga too",
        mentioned_user_ids: [w.emp2.id, w.outsider.id, w.emp1.id],
      })
      .select("mentioned_user_ids")
      .single();
    expect(c!.mentioned_user_ids).toEqual([w.emp2.id]); // outsider and self dropped

    const kinds = async (u: typeof w.emp1) =>
      ((await u.client.from("notifications").select("type").eq("task_id", t.id)).data ?? []).map((n) => n.type).sort();
    expect(await kinds(w.emp2)).toEqual(["mentioned"]);
    expect(await kinds(w.manager)).toEqual(["comment_added"]); // creator
    expect(await kinds(w.emp1)).toEqual(["task_assigned"]); // no self-notification for own comment
    expect((await w.outsider.client.from("notifications").select("id")).data).toEqual([]);
  });
});

describe("notifications", () => {
  it("are visible only to their recipient, and only read_at can change", async () => {
    const t = await createTask(w.manager, { title: "For emp1", assignee_id: w.emp1.id });
    const { data: mine } = await w.emp1.client.from("notifications").select("id, recipient_id").eq("task_id", t.id);
    expect(mine).toHaveLength(1);
    const id = mine![0].id;
    expect((await w.emp2.client.from("notifications").select("id").eq("id", id)).data).toEqual([]);
    expect((await w.admin.client.from("notifications").select("id").eq("id", id)).data).toEqual([]);
    expect(
      (await w.emp2.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).select())
        .data ?? [],
    ).toEqual([]);
    expect(
      (await w.emp1.client.from("notifications").update({ recipient_id: w.emp2.id }).eq("id", id)).error,
    ).not.toBeNull();
    const read = await w.emp1.client
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .select("read_at");
    expect(read.data?.[0].read_at).not.toBeNull();
    expect(
      (
        await w.emp1.client
          .from("notifications")
          .insert({ workspace_id: w.ws, recipient_id: w.emp2.id, type: "mentioned" })
      ).error,
    ).not.toBeNull();
  });

  it("covers completion, reopening and review requests", async () => {
    const t = await createTask(w.manager, { title: "Lifecycle", assignee_id: w.emp1.id });
    await updateTask(w.emp1, t.id, { status: "in_review" });
    await updateTask(w.emp1, t.id, { status: "done" });
    await updateTask(w.manager, t.id, { status: "todo" });
    const mgr = (
      (await w.manager.client.from("notifications").select("type").eq("task_id", t.id).order("created_at")).data ?? []
    ).map((n) => n.type);
    expect(mgr).toEqual(["review_requested", "task_completed"]);
    const emp = (
      (await w.emp1.client.from("notifications").select("type").eq("task_id", t.id).order("created_at")).data ?? []
    ).map((n) => n.type);
    expect(emp).toEqual(["task_assigned", "task_reopened"]);
  });

  it("generates due-soon and overdue reminders once per deadline (scheduler)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await w.admin.client
      .from("workspace_settings")
      .update({ timezone: "UTC", due_soon_hours: 48 })
      .eq("workspace_id", w.ws);
    const overdue = await createTask(w.manager, { title: "Late", assignee_id: w.emp1.id, due_date: yesterday });
    const soon = await createTask(w.manager, {
      title: "Soon",
      assignee_id: w.emp1.id,
      due_date: today,
      due_time: "23:59",
    });

    await sql("select private.run_scheduled_jobs()");
    await sql("select private.run_scheduled_jobs()"); // idempotent
    const forEmp = async (taskId: string) =>
      ((await w.emp1.client.from("notifications").select("type").eq("task_id", taskId)).data ?? [])
        .map((n) => n.type)
        .sort();
    expect(await forEmp(overdue.id)).toEqual(["task_assigned", "task_overdue"]);
    expect(await forEmp(soon.id)).toEqual(["task_assigned", "task_due_soon"]);
    const forCreator = (
      (await w.manager.client.from("notifications").select("type").eq("task_id", overdue.id)).data ?? []
    ).map((n) => n.type);
    expect(forCreator).toEqual(["task_overdue"]);

    const { rows } = await sql<{ schedule: string }>(
      "select schedule from cron.job where jobname = 'saunf-scheduled-jobs'",
    );
    expect(rows[0]?.schedule).toBe("*/15 * * * *");
  });

  it("the scheduler functions are not callable by app users", async () => {
    // `private` isn't exposed through the Data API at all.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/run_scheduled_jobs`, { method: "POST" });
    expect(res.ok).toBe(false);
    const viaClient = await w.admin.client.schema("private" as never).rpc("run_scheduled_jobs" as never);
    expect(viaClient.error).not.toBeNull();
  });
});

describe("attachments", () => {
  const file = () => new Blob(["quarterly numbers"], { type: "text/plain" });

  it("uploads to the private bucket for visible tasks and serves signed URLs only to viewers", async () => {
    const t = await createTask(w.emp1, { title: "Has files", assignee_id: w.emp1.id });
    const path = `${w.ws}/${t.id}/${crypto.randomUUID()}-notes.txt`;
    const up = await w.emp1.client.storage.from(ATTACHMENT_BUCKET).upload(path, file(), { contentType: "text/plain" });
    expect(up.error).toBeNull();
    const row = await w.emp1.client
      .from("task_attachments")
      .insert({
        task_id: t.id,
        workspace_id: w.ws,
        uploaded_by: w.emp1.id,
        storage_path: path,
        file_name: "notes.txt",
        mime_type: "text/plain",
        size_bytes: 17,
      })
      .select("id")
      .single();
    expect(row.error).toBeNull();

    const signed = await w.emp2.client.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 60);
    expect(signed.error).toBeNull(); // visibility "all": a colleague may download
    const body = await (await fetch(signed.data!.signedUrl)).text();
    expect(body).toBe("quarterly numbers");

    // Outsiders and anonymous users get nothing; the bucket is not public.
    expect((await w.outsider.client.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 60)).error).not.toBeNull();
    expect((await anonClient().storage.from(ATTACHMENT_BUCKET).download(path)).error).not.toBeNull();
    const publicUrl = anonClient().storage.from(ATTACHMENT_BUCKET).getPublicUrl(path).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);
    const { data: bucket } = await service.storage.getBucket(ATTACHMENT_BUCKET);
    expect(bucket?.public).toBe(false);

    const types = (await service.from("activity_events").select("event_type").eq("task_id", t.id)).data!.map(
      (e) => e.event_type,
    );
    expect(types).toContain("attachment_added");
  });

  it("rejects uploads to tasks the user can't see, to wrong paths, and of disallowed types", async () => {
    await w.admin.client
      .from("workspace_settings")
      .update({ task_visibility: "participants" })
      .eq("workspace_id", w.ws);
    const hidden = await createTask(w.manager, { title: "Not for emp2" });
    const bad = await w.emp2.client.storage
      .from(ATTACHMENT_BUCKET)
      .upload(`${w.ws}/${hidden.id}/x.txt`, file(), { contentType: "text/plain" });
    expect(bad.error).not.toBeNull();
    const own = await createTask(w.emp2, { title: "emp2 task" });
    const wrongWs = await w.emp2.client.storage
      .from(ATTACHMENT_BUCKET)
      .upload(`${w.otherWs}/${own.id}/x.txt`, file(), { contentType: "text/plain" });
    expect(wrongWs.error).not.toBeNull();
    const svg = await w.emp2.client.storage
      .from(ATTACHMENT_BUCKET)
      .upload(`${w.ws}/${own.id}/x.svg`, new Blob(["<svg/>"], { type: "image/svg+xml" }), {
        contentType: "image/svg+xml",
      });
    expect(svg.error).not.toBeNull();
    // A metadata row must point inside its own task's folder.
    const forged = await w.emp2.client.from("task_attachments").insert({
      task_id: own.id,
      workspace_id: w.ws,
      uploaded_by: w.emp2.id,
      storage_path: `${w.ws}/${hidden.id}/x.txt`,
      file_name: "x",
      mime_type: "text/plain",
      size_bytes: 1,
    });
    expect(forged.error).not.toBeNull();
    await w.admin.client.from("workspace_settings").update({ task_visibility: "all" }).eq("workspace_id", w.ws);
  });

  it("only the uploader or a task editor can delete an attachment", async () => {
    const t = await createTask(w.manager, { title: "Shared files", assignee_id: w.emp1.id });
    const path = `${w.ws}/${t.id}/${crypto.randomUUID()}-a.txt`;
    await w.emp1.client.storage.from(ATTACHMENT_BUCKET).upload(path, file(), { contentType: "text/plain" });
    const { data: row } = await w.emp1.client
      .from("task_attachments")
      .insert({
        task_id: t.id,
        workspace_id: w.ws,
        uploaded_by: w.emp1.id,
        storage_path: path,
        file_name: "a.txt",
        mime_type: "text/plain",
        size_bytes: 17,
      })
      .select("id")
      .single();
    expect((await w.emp2.client.from("task_attachments").delete().eq("id", row!.id).select()).data ?? []).toEqual([]);
    expect((await w.emp2.client.storage.from(ATTACHMENT_BUCKET).remove([path])).data ?? []).toEqual([]);
    expect((await w.manager.client.from("task_attachments").delete().eq("id", row!.id).select()).data).toHaveLength(1);
    expect((await w.manager.client.storage.from(ATTACHMENT_BUCKET).remove([path])).data).toHaveLength(1);
  });
});
