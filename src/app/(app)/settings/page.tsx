import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { PushToggle } from "@/components/settings/push-toggle";
import { PasswordForm, ProfileForm } from "@/components/settings/settings-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ASSIGNMENT_POLICY_LABEL, ROLE_LABEL, VISIBILITY_LABEL } from "@/lib/tasks/constants";

export const metadata: Metadata = { title: "Settings" };

async function SettingsContent() {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const [{ data: profile }, { data: dept }] = await Promise.all([
    supabase.from("profiles").select("full_name, job_title, email_notifications").eq("id", viewer.id).single(),
    viewer.departmentId
      ? supabase.from("departments").select("name").eq("id", viewer.departmentId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return (
    <div className="grid max-w-3xl gap-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Profile</CardTitle>
            <CardDescription>{viewer.email}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ProfileForm
            initial={{
              full_name: profile?.full_name ?? "",
              job_title: profile?.job_title ?? "",
              email_notifications: profile?.email_notifications ?? true,
            }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Push notifications</CardTitle>
            <CardDescription>
              Free pop-up alerts in your browser or on your phone. Turn on for each device.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <PushToggle />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Password</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Your access</CardTitle>
            <CardDescription>Managed by your workspace admins.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Workspace</dt>
            <dd>{viewer.workspaceName}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>{ROLE_LABEL[viewer.role]}</dd>
            <dt className="text-muted-foreground">Department</dt>
            <dd>{dept?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Assignment policy</dt>
            <dd>{ASSIGNMENT_POLICY_LABEL[viewer.settings.assignment_policy]}</dd>
            <dt className="text-muted-foreground">Task visibility</dt>
            <dd>{VISIBILITY_LABEL[viewer.settings.task_visibility]}</dd>
          </dl>
          {viewer.role === "admin" ? (
            <Link href="/admin/settings" className="mt-3 inline-block text-sm text-primary hover:underline">
              Change workspace settings
            </Link>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Your profile, password and notification preferences." />
      <Suspense fallback={<Skeleton className="h-96 max-w-3xl" />}>
        <SettingsContent />
      </Suspense>
    </>
  );
}
