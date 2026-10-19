import { z } from "zod";

import { TASK_PRIORITIES, WORKSPACE_ROLES } from "@/lib/tasks/constants";

const optionalUuid = z.union([z.uuid(), z.literal("").transform(() => null), z.null()]).optional();

export const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
    full_name: z.string().trim().min(1, "Enter their name").max(120),
    role: z.enum(WORKSPACE_ROLES),
    department_id: optionalUuid,
    mode: z.enum(["invite", "password"]),
    password: z.string().max(72).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "password" && (!v.password || v.password.length < 8)) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Set a temporary password of at least 8 characters",
      });
    }
  });
export type InviteInput = z.input<typeof inviteSchema>;

export const memberUpdateSchema = z.object({
  user_id: z.uuid(),
  role: z.enum(WORKSPACE_ROLES).optional(),
  department_id: optionalUuid,
  reports_to: optionalUuid,
});

export const departmentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(1000).optional(),
  manager_id: optionalUuid,
});
export type DepartmentInput = z.input<typeof departmentSchema>;

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** "Acme.com, @acme.in" → ["acme.com", "acme.in"] */
export const domainListSchema = z
  .string()
  .max(2000)
  .transform((v) =>
    [...new Set(v.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, "")))].filter(Boolean),
  )
  .pipe(z.array(z.string().regex(DOMAIN_RE, "Enter domains like acme.com, separated by commas")).max(50));

export const settingsSchema = z.object({
  workspace_name: z.string().trim().min(1, "Name is required").max(100),
  employees_can_create_tasks: z.boolean(),
  assignment_policy: z.enum(["anyone", "department", "self"]),
  task_visibility: z.enum(["all", "participants"]),
  default_status: z.enum(["todo", "in_progress", "in_review"]),
  default_priority: z.enum(TASK_PRIORITIES),
  timezone: z.string().min(1).max(64),
  due_soon_hours: z.coerce.number().int().min(1, "At least 1 hour").max(168, "At most 168 hours"),
  due_reminders_enabled: z.boolean(),
  email_notifications_enabled: z.boolean(),
  self_signup_enabled: z.boolean(),
  signup_allowed_domains: domainListSchema,
  signup_requires_approval: z.boolean(),
  auto_archive_done_after_days: z.union([
    z.coerce.number().int().min(1).max(3650),
    z.literal("").transform(() => null),
    z.null(),
  ]),
});
export type SettingsInput = z.input<typeof settingsSchema>;
