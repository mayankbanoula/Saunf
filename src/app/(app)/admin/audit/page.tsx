import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActivityTimeline } from "@/components/activity-timeline";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { Card, CardContent, Skeleton } from "@/components/ui/primitives";
import type { ActivityEvent } from "@/lib/activity";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { cn, displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Audit log" };

const PAGE = 100;
const GROUPS: Record<string, string[] | null> = {
  all: null,
  members: ["member_joined", "member_role_changed", "member_department_changed", "member_deactivated", "member_reactivated", "invitation_sent", "invitation_revoked"],
  settings: ["settings_updated", "department_created", "department_updated", "department_deleted"],
  assignments: ["task_assigned", "task_reassigned", "task_unassigned"],
  lifecycle: ["task_created", "task_completed", "task_reopened", "task_archived", "task_restored"],
  files: ["attachment_added", "attachment_removed"],
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Audit({ searchParams }: { searchParams: Promise<SP> }) {
  const viewer = await requireRole(["admin"]);
  const sp = await searchParams;
  const group = one(sp.group) && one(sp.group)! in GROUPS ? one(sp.group)! : "all";
  const actor = one(sp.actor);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const supabase = await createClient();
  let query = supabase
    .from("activity_events")
    .select("id, event_type, created_at, old_value, new_value, metadata, actor:profiles!activity_events_actor_id_fkey(id, full_name, email), task:tasks(key, title)")
    .eq("workspace_id", viewer.workspaceId)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE);
  if (GROUPS[group]) query = query.in("event_type", GROUPS[group]!);
  if (actor && /^[0-9a-f-]{36}$/.test(actor)) query = query.eq("actor_id", actor);
  const [{ data, error }, { data: members }] = await Promise.all([
    query,
    supabase.from("workspace_members").select("user_id, profiles!workspace_members_user_id_fkey(full_name, email)").eq("workspace_id", viewer.workspaceId),
  ]);
  if (error) throw new Error(`Could not load the audit log: ${error.message}`);
  const rows = (data ?? []) as unknown as ActivityEvent[];
  const link = (p: number) => `/admin/audit?${new URLSearchParams({ group, ...(actor ? { actor } : {}), page: String(p) })}`;

  return (
    <>
      <form className="mb-4 flex flex-wrap items-end gap-2" action="/admin/audit">
        <NativeSelect name="group" defaultValue={group} aria-label="Event type" className="h-8 w-auto text-sm">
          <option value="all">All events</option>
          <option value="members">Members & invitations</option>
          <option value="settings">Settings & departments</option>
          <option value="assignments">Assignments</option>
          <option value="lifecycle">Created / completed / archived</option>
          <option value="files">Attachments</option>
        </NativeSelect>
        <NativeSelect name="actor" defaultValue={actor ?? ""} aria-label="Actor" className="h-8 w-auto text-sm">
          <option value="">Anyone</option>
          {(members ?? []).map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {displayName(m.profiles)}
            </option>
          ))}
        </NativeSelect>
        <Button size="sm" variant="outline" type="submit">
          Apply
        </Button>
        <p className="ml-auto text-xs text-muted-foreground">Audit history is append-only; it can&apos;t be edited or deleted from the app.</p>
      </form>
      <Card>
        <CardContent className="pt-5 pl-9">
          <ActivityTimeline events={rows.slice(0, PAGE)} showTask emptyText="No matching events." />
        </CardContent>
      </Card>
      <div className="mt-3 flex justify-between">
        <Button asChild variant="outline" size="sm" className={cn(page <= 1 && "invisible")}>
          <Link href={link(page - 1)}>Newer</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className={cn(rows.length <= PAGE && "invisible")}>
          <Link href={link(page + 1)}>Older</Link>
        </Button>
      </div>
    </>
  );
}

export default function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Audit searchParams={searchParams} />
    </Suspense>
  );
}
