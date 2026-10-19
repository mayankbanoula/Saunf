import { ActivityIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActivityTimeline } from "@/components/activity-timeline";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { PersonPicker } from "@/components/person-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Skeleton } from "@/components/ui/primitives";
import type { ActivityEvent } from "@/lib/activity";
import { requireViewer } from "@/lib/auth/session";
import { requestedMember, resolvePeopleView } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Activity" };

const PAGE = 50;
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function ActivityContent({ searchParams }: { searchParams: Promise<SP> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const audit = one(sp.scope) === "workspace" && viewer.role === "admin";
  const viewPromise = resolvePeopleView(viewer, sp.person);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const supabase = await createClient();

  // Activity on tasks you're involved in and your own other actions; managers add their
  // reportees', admins see everything. The audit tab shows workspace-level events only.
  let query = (
    audit
      ? supabase.from("activity_events")
      : supabase.rpc("activity_in_view", { p_member: requestedMember(viewer, sp.person) })
  )
    .select(
      "id, event_type, created_at, old_value, new_value, metadata, actor:profiles!activity_events_actor_id_fkey(id, full_name, email), task:tasks(key, title), project:projects(id, name)",
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE);
  if (audit) query = query.is("task_id", null);
  const [view, { data, error }] = await Promise.all([viewPromise, query]);
  if (error) throw new Error(`Could not load activity: ${error.message}`);
  const rows = (data ?? []) as unknown as ActivityEvent[];
  const hasMore = rows.length > PAGE;
  const events = rows.slice(0, PAGE);

  const params = (p: number) =>
    new URLSearchParams({
      ...(audit ? { scope: "workspace" } : {}),
      ...(!audit && view.current !== view.options[0]?.value && view.options.length ? { person: view.current } : {}),
      page: String(p),
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {audit ? null : <PersonPicker current={view.current} options={view.options} />}
        {viewer.role === "admin" ? (
          <div className="flex rounded-md border bg-card p-0.5 sm:w-fit" role="group" aria-label="Activity scope">
            <Button asChild size="xs" variant={!audit ? "secondary" : "ghost"}>
              <Link href="/activity">Tasks & projects</Link>
            </Button>
            <Button asChild size="xs" variant={audit ? "secondary" : "ghost"}>
              <Link href="/activity?scope=workspace">Admin & audit</Link>
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {view.options.length ? "Activity on your and your team's tasks." : "Activity on your tasks."}
          </p>
        )}
      </div>
      {events.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="No activity yet"
          description="Changes to tasks and projects will appear here."
        />
      ) : (
        <Card>
          <CardContent className="pt-5 pl-9">
            <ActivityTimeline events={events} showTask />
          </CardContent>
        </Card>
      )}
      <div className="mt-3 flex justify-between">
        <Button asChild variant="outline" size="sm" className={cn(page <= 1 && "invisible")}>
          <Link href={`/activity?${params(page - 1)}`}>Newer</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className={cn(!hasMore && "invisible")}>
          <Link href={`/activity?${params(page + 1)}`}>Older</Link>
        </Button>
      </div>
    </>
  );
}

export default function ActivityPage({ searchParams }: PageProps<"/activity">) {
  return (
    <>
      <PageHeader title="Activity" description="A chronological record of changes to tasks and projects." />
      <Suspense fallback={<Skeleton className="h-[500px]" />}>
        <ActivityContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
