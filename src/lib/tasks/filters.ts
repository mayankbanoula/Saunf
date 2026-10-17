import { z } from "zod";

import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/tasks/constants";

export const SORT_FIELDS = ["due", "priority", "created", "updated", "key"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_COLUMN: Record<SortField, string> = {
  due: "due_date",
  priority: "priority",
  created: "created_at",
  updated: "updated_at",
  key: "number",
};

const idOrKeyword = (keywords: string[]) =>
  z.union([z.uuid(), z.enum(keywords as [string, ...string[]])]).optional().catch(undefined);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined);

function csvEnum<T extends string>(values: readonly T[]) {
  return z
    .string()
    .optional()
    .transform((v) => (v ? (v.split(",").filter((x) => (values as readonly string[]).includes(x)) as T[]) : []))
    .catch([]);
}

export const taskFiltersSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  status: csvEnum<TaskStatus>(TASK_STATUSES),
  priority: csvEnum<TaskPriority>(TASK_PRIORITIES),
  assignee: idOrKeyword(["me", "none"]),
  creator: idOrKeyword(["me"]),
  project: idOrKeyword(["none"]),
  department: z.uuid().optional().catch(undefined),
  label: z.uuid().optional().catch(undefined),
  due: z.enum(["overdue", "today", "week", "none"]).optional().catch(undefined),
  due_from: isoDate,
  due_to: isoDate,
  created_from: isoDate,
  created_to: isoDate,
  completed_from: isoDate,
  completed_to: isoDate,
  archived: z.enum(["only", "include"]).optional().catch(undefined),
  blocked: z.enum(["1"]).optional().catch(undefined),
  open: z.enum(["1"]).optional().catch(undefined),
  sort: z.enum(SORT_FIELDS).catch("updated").default("updated"),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).catch(1).default(1),
  view: z.enum(["list", "board"]).catch("list").default("list"),
});

export type TaskFilters = z.infer<typeof taskFiltersSchema>;

type RawParams = Record<string, string | string[] | undefined>;

export function parseTaskFilters(params: RawParams, overrides: Partial<Record<string, string>> = {}): TaskFilters {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(params)) flat[k] = Array.isArray(v) ? v[0] : v;
  return taskFiltersSchema.parse({ ...flat, ...overrides });
}

/** Default sort direction for each field (soonest due first, most urgent first, newest first). */
export function sortDirection(filters: TaskFilters): "asc" | "desc" {
  if (filters.dir) return filters.dir;
  return filters.sort === "due" ? "asc" : "desc";
}

/** Serialise filters back to a query string, dropping defaults. */
export function filtersToSearchParams(filters: Partial<TaskFilters>): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(","));
      continue;
    }
    if (k === "page" && v === 1) continue;
    if (k === "sort" && v === "updated") continue;
    if (k === "view" && v === "list") continue;
    sp.set(k, String(v));
  }
  return sp;
}

export function activeFilterCount(filters: TaskFilters) {
  return [
    filters.q,
    filters.status.length ? 1 : undefined,
    filters.priority.length ? 1 : undefined,
    filters.assignee,
    filters.creator,
    filters.project,
    filters.department,
    filters.label,
    filters.due,
    filters.due_from || filters.due_to,
    filters.created_from || filters.created_to,
    filters.completed_from || filters.completed_to,
    filters.archived,
    filters.blocked,
    filters.open,
  ].filter(Boolean).length;
}
