import { z } from "zod";

export const profileSchema = z.object({
  full_name: z.string().trim().min(1, "Enter your name").max(120),
  job_title: z.string().trim().max(120).optional(),
  email_notifications: z.boolean(),
});
export type ProfileInput = z.input<typeof profileSchema>;

export const passwordChangeSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    password: z.string().min(8, "Use at least 8 characters").max(72),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });
export type PasswordChangeInput = z.input<typeof passwordChangeSchema>;
