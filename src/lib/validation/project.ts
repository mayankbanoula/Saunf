import { z } from "zod";

import { PROJECT_STATUSES } from "@/lib/tasks/constants";

const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("").transform(() => null), z.null()])
  .optional();

export const projectSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    description: z.string().max(5000).optional().default(""),
    status: z.enum(PROJECT_STATUSES).default("active"),
    owner_id: z.union([z.uuid(), z.literal("").transform(() => null), z.null()]).optional(),
    start_date: optionalDate,
    target_date: optionalDate,
    is_private: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.start_date && v.target_date && v.target_date < v.start_date) {
      ctx.addIssue({ code: "custom", path: ["target_date"], message: "Target date cannot be before the start date" });
    }
  });
export type ProjectInput = z.input<typeof projectSchema>;
