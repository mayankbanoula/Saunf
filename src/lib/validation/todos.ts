import { z } from "zod";

export const TODO_REPEATS = ["none", "daily", "weekdays"] as const;
export type TodoRepeat = (typeof TODO_REPEATS)[number];

export const TODO_REPEAT_LABEL: Record<TodoRepeat, string> = {
  none: "Once",
  daily: "Every day",
  weekdays: "Every weekday",
};

export const todoSchema = z.object({
  title: z.string().trim().min(1, "Write something to do").max(200),
  repeat: z.enum(TODO_REPEATS),
  due_date: z
    .union([z.iso.date(), z.literal("").transform(() => null), z.null()])
    .optional()
    .transform((v) => v ?? null),
});
export type TodoInput = z.input<typeof todoSchema>;
