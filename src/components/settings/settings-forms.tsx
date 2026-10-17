"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { changePassword, updateProfile } from "@/actions/profile";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/overlays";
import { passwordChangeSchema, profileSchema } from "@/lib/validation/profile";

type ProfileIn = z.input<typeof profileSchema>;
type ProfileOut = z.output<typeof profileSchema>;

export function ProfileForm({ initial }: { initial: ProfileIn }) {
  const form = useForm<ProfileIn, unknown, ProfileOut>({ resolver: zodResolver(profileSchema), defaultValues: initial });
  const onSubmit = async (v: ProfileOut) => {
    const res = await updateProfile(v);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Profile saved");
    form.reset(v);
  };
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="full_name" error={form.formState.errors.full_name?.message}>
          <Input {...form.register("full_name")} autoComplete="name" />
        </Field>
        <Field label="Job title" htmlFor="job_title">
          <Input {...form.register("job_title")} />
        </Field>
      </div>
      <div className="flex items-start justify-between gap-4">
        <label htmlFor="email_notifications" className="text-sm">
          <span className="font-medium">Email me notifications</span>
          <span className="block text-xs text-muted-foreground">Applies when your workspace has email notifications enabled.</span>
        </label>
        <Switch
          id="email_notifications"
          checked={form.watch("email_notifications")}
          onCheckedChange={(c) => form.setValue("email_notifications", c, { shouldDirty: true })}
        />
      </div>
      <div>
        <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
          {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null} Save profile
        </Button>
      </div>
    </form>
  );
}

type PwIn = z.input<typeof passwordChangeSchema>;
type PwOut = z.output<typeof passwordChangeSchema>;

export function PasswordForm() {
  const form = useForm<PwIn, unknown, PwOut>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { current: "", password: "", confirm: "" },
  });
  const onSubmit = async (v: PwOut) => {
    const res = await changePassword(v);
    if (!res.ok) {
      if (res.fieldErrors?.current) form.setError("current", { message: res.fieldErrors.current[0] });
      return void toast.error(res.error);
    }
    toast.success("Password changed");
    form.reset();
  };
  const e = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid max-w-sm gap-4" noValidate>
      <Field label="Current password" htmlFor="current" error={e.current?.message}>
        <Input type="password" autoComplete="current-password" {...form.register("current")} />
      </Field>
      <Field label="New password" htmlFor="new-password" error={e.password?.message} hint="At least 8 characters.">
        <Input type="password" autoComplete="new-password" {...form.register("password")} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm-password" error={e.confirm?.message}>
        <Input type="password" autoComplete="new-password" {...form.register("confirm")} />
      </Field>
      <div>
        <Button type="submit" variant="outline" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null} Change password
        </Button>
      </div>
    </form>
  );
}
