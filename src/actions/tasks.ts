"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { dbErrorMessage, fail, ok, runAction, validationFailure, type ActionResult } from "@/lib/actions";
import { canCreateTasks, viewerForAction } from "@/lib/auth/session";
import type { Json } from "@/lib/database.types";
import { deliverNotificationsAfter } from "@/lib/delivery";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENT_BUCKET, ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES } from "@/lib/tasks/constants";
import {
  assignTaskSchema,
  attachmentSchema,
  bulkUpdateSchema,
  commentSchema,
  createTaskSchema,
  dependencySchema,
  taskStatusSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type UpdateTaskInput,
} from "@/lib/validation/task";

const TASK_FIELDS = [
  "title",
  "description",
  "status",
  "priority",
  "progress",
  "assignee_id",
  "project_id",
  "department_id",
  "parent_id",
  "start_date",
  "due_date",
  "due_time",
  "estimate_hours",
  "is_blocked",
  "blocker_description",
  "archived",
] as const;

function pickPatch(data: Record<string, unknown>): Record<string, Json> {
  const patch: Record<string, Json> = {};
  for (const key of TASK_FIELDS) {
    if (key in data && data[key] !== undefined) patch[key] = data[key] as Json;
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Form options
// ---------------------------------------------------------------------------
export type TaskFormOptions = {
  members: { id: string; full_name: string; email: string; department_id: string | null }[];
  projects: { id: string; name: string }[];
  labels: { id: string; name: string; color: string }[];
  departments: { id: string; name: string }[];
  viewer: {
    id: string;
    role: "admin" | "manager" | "employee";
    departmentId: string | null;
    managedDepartmentIds: string[];
    assignmentPolicy: "anyone" | "department" | "self";
    canCreate: boolean;
    defaultStatus: "todo" | "in_progress" | "in_review" | "done";
    defaultPriority: "low" | "medium" | "high" | "urgent";
  };
};

export async function getTaskFormOptions(): Promise<ActionResult<TaskFormOptions>> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const supabase = await createClient();
    const [members, projects, labels, departments] = await Promise.all([
      supabase
        .from("workspace_members")
        .select("user_id, department_id, profiles!workspace_members_user_id_fkey(full_name, email)")
        .eq("workspace_id", viewer.workspaceId)
        .eq("is_active", true),
      supabase
        .from("projects")
        .select("id, name")
        .is("archived_at", null)
        .in("status", ["planning", "active", "on_hold"])
        .order("name"),
      supabase.from("labels").select("id, name, color").order("name"),
      supabase.from("departments").select("id, name, manager_id").order("name"),
    ]);
    const err = members.error ?? projects.error ?? labels.error ?? departments.error;
    if (err) {
      console.error("[tasks] options", err);
      return fail("Could not load form options.");
    }
    return ok({
      members: (members.data ?? [])
        .map((m) => ({
          id: m.user_id,
          full_name: m.profiles?.full_name || m.profiles?.email || "Unknown",
          email: m.profiles?.email ?? "",
          department_id: m.department_id,
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
      projects: projects.data ?? [],
      labels: labels.data ?? [],
      departments: (departments.data ?? []).map(({ id, name }) => ({ id, name })),
      viewer: {
        id: viewer.id,
        role: viewer.role,
        departmentId: viewer.departmentId,
        managedDepartmentIds: (departments.data ?? []).filter((d) => d.manager_id === viewer.id).map((d) => d.id),
        assignmentPolicy: viewer.settings.assignment_policy,
        canCreate: canCreateTasks(viewer),
        defaultStatus: viewer.settings.default_status,
        defaultPriority: viewer.settings.default_priority,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------
export async function createTask(input: CreateTaskInput): Promise<ActionResult<{ id: string; key: string }>> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    if (!canCreateTasks(viewer)) return fail("Your workspace doesn't allow you to create tasks.");
    const parsed = createTaskSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const { label_ids, collaborator_ids, note, ...fields } = parsed.data;

    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("create_task", {
        p_task: pickPatch(fields),
        p_label_ids: label_ids,
        p_collaborator_ids: collaborator_ids,
        p_note: note ?? undefined,
      })
      .single();
    if (error || !data) return fail(error ? dbErrorMessage(error) : "Could not create the task.");
    deliverNotificationsAfter(viewer.id);
    refresh();
    return ok(data);
  });
}

export async function updateTask(
  taskId: string,
  input: UpdateTaskInput,
  extra: { label_ids?: string[]; collaborator_ids?: string[]; note?: string } = {},
): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const id = z.uuid().safeParse(taskId);
    if (!id.success) return fail("Invalid task.");
    const parsed = updateTaskSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const ids = z
      .object({
        label_ids: z.array(z.uuid()).max(20).optional(),
        collaborator_ids: z.array(z.uuid()).max(50).optional(),
        note: z.string().trim().max(500).optional(),
      })
      .safeParse(extra);
    if (!ids.success) return validationFailure(ids.error);

    const supabase = await createClient();
    const { error } = await supabase.rpc("update_task", {
      p_task_id: id.data,
      p_patch: pickPatch(parsed.data),
      p_label_ids: ids.data.label_ids,
      p_collaborator_ids: ids.data.collaborator_ids,
      p_note: ids.data.note,
    });
    if (error) return fail(dbErrorMessage(error));
    deliverNotificationsAfter(viewer.id);
    refresh();
    return ok(null);
  });
}

export async function setTaskStatus(taskId: string, status: string): Promise<ActionResult> {
  const parsed = taskStatusSchema.safeParse(status);
  if (!parsed.success) return fail("Invalid status.");
  return updateTask(taskId, { status: parsed.data });
}

export async function assignTask(input: z.input<typeof assignTaskSchema>): Promise<ActionResult> {
  const parsed = assignTaskSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  return updateTask(parsed.data.task_id, { assignee_id: parsed.data.assignee_id }, { note: parsed.data.note });
}

export async function setTaskArchived(taskId: string, archived: boolean): Promise<ActionResult> {
  return updateTask(taskId, { archived });
}

export async function bulkUpdateTasks(input: z.input<typeof bulkUpdateSchema>): Promise<ActionResult<number>> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const parsed = bulkUpdateSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("bulk_update_tasks", {
      p_task_ids: parsed.data.task_ids,
      p_patch: pickPatch(parsed.data.patch),
    });
    if (error) return fail(dbErrorMessage(error));
    deliverNotificationsAfter(viewer.id);
    refresh();
    return ok(data ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
const LABEL_COLORS = ["#262f82", "#2f6f9f", "#b7791f", "#9966ff", "#c2410c", "#cc66ff", "#64748b"];

export async function createLabel(name: string): Promise<ActionResult<{ id: string; name: string; color: string }>> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const parsed = z.string().trim().min(1, "Name the label").max(40).safeParse(name);
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const color = LABEL_COLORS[Math.floor(Math.random() * LABEL_COLORS.length)];
    const { data, error } = await supabase
      .from("labels")
      .insert({ workspace_id: viewer.workspaceId, name: parsed.data, color, created_by: viewer.id })
      .select("id, name, color")
      .single();
    if (error) return fail(error.code === "23505" ? "A label with that name already exists." : dbErrorMessage(error));
    return ok(data);
  });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
async function taskWorkspace(supabase: Awaited<ReturnType<typeof createClient>>, taskId: string) {
  const { data } = await supabase.from("tasks").select("id, workspace_id, archived_at").eq("id", taskId).maybeSingle();
  return data;
}

export async function addComment(input: z.input<typeof commentSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const parsed = commentSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const task = await taskWorkspace(supabase, parsed.data.task_id);
    if (!task) return fail("Task not found.");
    if (task.archived_at) return fail("Archived tasks can't receive comments.");
    const { error } = await supabase.from("task_comments").insert({
      task_id: task.id,
      workspace_id: task.workspace_id,
      author_id: viewer.id,
      body: parsed.data.body,
      mentioned_user_ids: parsed.data.mentioned_user_ids,
    });
    if (error) return fail(dbErrorMessage(error));
    deliverNotificationsAfter(viewer.id);
    refresh();
    return ok(null);
  });
}

export async function editComment(commentId: string, body: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    const parsed = z
      .object({ id: z.uuid(), body: z.string().trim().min(1, "Comment can't be empty").max(10000) })
      .safeParse({ id: commentId, body });
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("task_comments")
      .update({ body: parsed.data.body })
      .eq("id", parsed.data.id)
      .select("id");
    if (error) return fail(dbErrorMessage(error));
    if (!data?.length) return fail("You can only edit your own comments.");
    refresh();
    return ok(null);
  });
}

export async function deleteComment(commentId: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    const id = z.uuid().safeParse(commentId);
    if (!id.success) return fail("Invalid comment.");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("task_comments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id.data)
      .select("id");
    if (error) return fail(dbErrorMessage(error));
    if (!data?.length) return fail("You can't delete this comment.");
    refresh();
    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// Attachments (browser uploads directly to private Storage; storage RLS applies)
// ---------------------------------------------------------------------------
function sanitizeFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(-120);
  return cleaned || "file";
}

export async function prepareAttachmentUpload(input: {
  task_id: string;
  file_name: string;
  size_bytes: number;
  mime_type: string;
}): Promise<ActionResult<{ path: string; bucket: string }>> {
  return runAction(async () => {
    await viewerForAction();
    const parsed = z
      .object({
        task_id: z.uuid(),
        file_name: z.string().trim().min(1).max(255),
        size_bytes: z.number().int().positive().max(ATTACHMENT_MAX_BYTES, "Files must be 25 MB or smaller"),
        mime_type: z.enum(ATTACHMENT_MIME_TYPES, { message: "This file type isn't allowed" }),
      })
      .safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const task = await taskWorkspace(supabase, parsed.data.task_id);
    if (!task) return fail("Task not found.");
    if (task.archived_at) return fail("Archived tasks can't receive attachments.");
    const path = `${task.workspace_id}/${task.id}/${crypto.randomUUID()}-${sanitizeFileName(parsed.data.file_name)}`;
    return ok({ path, bucket: ATTACHMENT_BUCKET });
  });
}

export async function recordAttachment(input: z.input<typeof attachmentSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const parsed = attachmentSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const task = await taskWorkspace(supabase, parsed.data.task_id);
    if (!task) return fail("Task not found.");

    // Trust the size/type Storage recorded, not the browser's claim.
    const folder = parsed.data.storage_path.split("/").slice(0, 2).join("/");
    const fileName = parsed.data.storage_path.split("/").at(-1) ?? "";
    const { data: listed } = await supabase.storage.from(ATTACHMENT_BUCKET).list(folder, { search: fileName });
    const object = listed?.find((o) => o.name === fileName);
    if (!object) return fail("Upload not found. Please try again.");
    const size = Number(object.metadata?.size ?? parsed.data.size_bytes);
    const mime = String(object.metadata?.mimetype ?? parsed.data.mime_type);

    const { error } = await supabase.from("task_attachments").insert({
      task_id: task.id,
      workspace_id: task.workspace_id,
      uploaded_by: viewer.id,
      storage_path: parsed.data.storage_path,
      file_name: parsed.data.file_name,
      mime_type: mime,
      size_bytes: size,
    });
    if (error) {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([parsed.data.storage_path]);
      return fail(dbErrorMessage(error));
    }
    refresh();
    return ok(null);
  });
}

export async function getAttachmentUrl(attachmentId: string): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    await viewerForAction();
    const id = z.uuid().safeParse(attachmentId);
    if (!id.success) return fail("Invalid attachment.");
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("task_attachments")
      .select("storage_path, file_name")
      .eq("id", id.data)
      .maybeSingle();
    if (!row) return fail("Attachment not found.");
    const { data, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(row.storage_path, 60, { download: row.file_name });
    if (error || !data) return fail("Could not create a download link.");
    return ok({ url: data.signedUrl });
  });
}

export async function deleteAttachment(attachmentId: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    const id = z.uuid().safeParse(attachmentId);
    if (!id.success) return fail("Invalid attachment.");
    const supabase = await createClient();
    const { data: deleted, error } = await supabase
      .from("task_attachments")
      .delete()
      .eq("id", id.data)
      .select("storage_path");
    if (error) return fail(dbErrorMessage(error));
    if (!deleted?.length) return fail("You can't delete this attachment.");
    const { error: storageError } = await supabase.storage.from(ATTACHMENT_BUCKET).remove([deleted[0].storage_path]);
    if (storageError) console.error("[attachments] orphaned object", deleted[0].storage_path, storageError.message);
    refresh();
    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------
export async function addDependency(taskId: string, dependsOnKey: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    const parsed = z
      .object({
        taskId: z.uuid(),
        key: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2,6}-\d+$/, "Enter a task ID like SAU-00012"),
      })
      .safeParse({ taskId, key: dependsOnKey });
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const task = await taskWorkspace(supabase, parsed.data.taskId);
    if (!task) return fail("Task not found.");
    const { data: other } = await supabase.from("tasks").select("id").eq("key", parsed.data.key).maybeSingle();
    if (!other) return fail(`No task ${parsed.data.key} that you can see.`);
    const dep = dependencySchema.parse({ task_id: task.id, depends_on_task_id: other.id });
    if (dep.task_id === dep.depends_on_task_id) return fail("A task can't depend on itself.");
    const { error } = await supabase.from("task_dependencies").insert({ ...dep, workspace_id: task.workspace_id });
    if (error) return fail(error.code === "23505" ? "That dependency already exists." : dbErrorMessage(error));
    refresh();
    return ok(null);
  });
}

export async function removeDependency(taskId: string, dependsOnId: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    const parsed = dependencySchema.safeParse({ task_id: taskId, depends_on_task_id: dependsOnId });
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("task_dependencies")
      .delete()
      .eq("task_id", parsed.data.task_id)
      .eq("depends_on_task_id", parsed.data.depends_on_task_id)
      .select("task_id");
    if (error) return fail(dbErrorMessage(error));
    if (!data?.length) return fail("You can't change this task's dependencies.");
    refresh();
    return ok(null);
  });
}
