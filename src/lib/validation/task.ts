import { z } from "zod";

import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/constants";

const uuid = z.uuid({ message: "Invalid id" });
const optionalUuid = z.union([uuid, z.literal("").transform(() => null), z.null()]).optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optionalDate = z.union([isoDate, z.literal("").transform(() => null), z.null()]).optional();
const optionalTime = z
  .union([z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM"), z.literal("").transform(() => null), z.null()])
  .optional();

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

const taskFields = {
  title: z.string().trim().min(1, "Title is required").max(200, "Keep the title under 200 characters"),
  description: z.string().max(20000, "Description is too long").optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  progress: z.coerce.number().int().min(0, "Progress must be 0–100").max(100, "Progress must be 0–100").optional(),
  assignee_id: optionalUuid,
  project_id: optionalUuid,
  department_id: optionalUuid,
  parent_id: optionalUuid,
  start_date: optionalDate,
  due_date: optionalDate,
  due_time: optionalTime,
  estimate_hours: z
    .union([z.coerce.number().positive("Estimate must be positive").max(10000), z.literal("").transform(() => null), z.null()])
    .optional(),
  is_blocked: z.boolean().optional(),
  blocker_description: z.string().trim().max(2000).nullable().optional(),
};

function checkDates(
  v: { start_date?: string | null; due_date?: string | null; due_time?: string | null },
  ctx: z.RefinementCtx,
) {
  if (v.start_date && v.due_date && v.due_date < v.start_date) {
    ctx.addIssue({ code: "custom", path: ["due_date"], message: "Due date cannot be before the start date" });
  }
  if (v.due_time && !v.due_date) {
    ctx.addIssue({ code: "custom", path: ["due_time"], message: "Set a due date before adding a time" });
  }
}

export const createTaskSchema = z
  .object({
    ...taskFields,
    label_ids: z.array(uuid).max(20).default([]),
    collaborator_ids: z.array(uuid).max(50).default([]),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine(checkDates);
export type CreateTaskInput = z.input<typeof createTaskSchema>;

/** A partial update. Only keys present are changed. */
export const updateTaskSchema = z
  .object({
    ...taskFields,
    title: taskFields.title.optional(),
    archived: z.boolean().optional(),
  })
  .partial()
  .superRefine(checkDates);
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

export const assignTaskSchema = z.object({
  task_id: uuid,
  assignee_id: z.union([uuid, z.null()]),
  note: z.string().trim().max(500).optional(),
});

export const bulkUpdateSchema = z.object({
  task_ids: z.array(uuid).min(1).max(200),
  patch: z
    .object({
      status: taskStatusSchema.optional(),
      priority: taskPrioritySchema.optional(),
      assignee_id: z.union([uuid, z.null()]).optional(),
      archived: z.boolean().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "Nothing to update"),
});

export const commentSchema = z.object({
  task_id: uuid,
  body: z.string().trim().min(1, "Write a comment first").max(10000, "Comment is too long"),
  mentioned_user_ids: z.array(uuid).max(50).default([]),
});

export const attachmentSchema = z.object({
  task_id: uuid,
  storage_path: z.string().min(1).max(600),
  file_name: z.string().trim().min(1).max(255),
  mime_type: z.string().min(1).max(255),
  size_bytes: z.number().int().positive(),
});

export const dependencySchema = z.object({ task_id: uuid, depends_on_task_id: uuid });
