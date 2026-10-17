import type { Metadata } from "next";
import { Suspense } from "react";

import { SettingsForm } from "@/components/admin/admin-components";
import { Skeleton } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin · Settings" };

async function Settings() {
  const viewer = await requireRole(["admin"]);
  const s = viewer.settings;
  const timezones = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((tz) => tz !== "UTC")];
  if (!timezones.includes(s.timezone)) timezones.unshift(s.timezone);
  return (
    <SettingsForm
      timezones={timezones}
      initial={{
        workspace_name: viewer.workspaceName,
        employees_can_create_tasks: s.employees_can_create_tasks,
        assignment_policy: s.assignment_policy,
        task_visibility: s.task_visibility,
        default_status: s.default_status === "done" ? "todo" : s.default_status,
        default_priority: s.default_priority,
        timezone: s.timezone,
        due_soon_hours: s.due_soon_hours,
        due_reminders_enabled: s.due_reminders_enabled,
        email_notifications_enabled: s.email_notifications_enabled,
        auto_archive_done_after_days: s.auto_archive_done_after_days ?? "",
        self_signup_enabled: s.self_signup_enabled,
        signup_allowed_domains: s.signup_allowed_domains.join(", "),
        signup_requires_approval: s.signup_requires_approval,
      }}
    />
  );
}

export default function AdminSettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px] max-w-3xl" />}>
      <Settings />
    </Suspense>
  );
}
