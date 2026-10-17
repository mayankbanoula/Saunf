import { ActivityIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActivityTimeline } from "@/components/activity-timeline";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Skeleton } from "@/components/ui/primitives";
import type { ActivityEvent } from "@/lib/activity";
import { requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Activity" };

const PAGE = 50;
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function ActivityContent({ searchParams }: { searchParams: Promise<SP> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const scope = one(sp.scope) === "mine" ? "mine" : one(sp.scope) === "workspace" && viewer.role === "admin" ? "workspace" : "all";
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const supabase = await createClient();

  // RLS: task events only for tasks the viewer can see; workspace events only for admins.
  let query = supabase
    .from("activity_events")
    .select(
      "id, event_type, created_at, old_value, new_value, metadata, actor:profiles!activity_events_actor_id_fkey(id, full_name, email), task:tasks(key, title), project:projects(id, name)",
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE);
  if (scope === "mine") query = query.eq("actor_id", viewer.id);
  if (scope === "workspace") query = query.is("task_id", null);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load activity: ${error.message}`);
  const rows = (data ?? []) as unknown as ActivityEvent[];
  const hasMore = rows.length > PAGE;
  const events = rows.slice(0, PAGE);

  const tab = (key: string, label: string) => (
    <Button asChild size="xs" variant={scope === key ? "secondary" : "ghost"}>
      <Link href={key === "all" ? "/activity" : `/activity?scope=${key}`}>{label}</Link>
    </Button>
  );

  return (
    <>
      <div className="mb-4 flex rounded-md border bg-card p-0.5 sm:w-fit" role="group" aria-label="Activity scope">
        {tab("all", "Everything I can see")}
        {tab("mine", "My actions")}
        {viewer.role === "admin" ? tab("workspace", "Admin & audit") : null}
      </div>
      {events.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="No activity yet" description="Changes to tasks and projects will appear here." />
      ) : (
        <Card>
          <CardContent className="pt-5 pl-9">
            <ActivityTimeline events={events} showTask />
          </CardContent>
        </Card>
      )}
      <div className="mt-3 flex justify-between">
        <Button asChild variant="outline" size="sm" className={cn(page <= 1 && "invisible")}>
          <Link href={`/activity?${new URLSearchParams({ ...(scope !== "all" ? { scope } : {}), page: String(page - 1) })}`}>Newer</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className={cn(!hasMore && "invisible")}>
          <Link href={`/activity?${new URLSearchParams({ ...(scope !== "all" ? { scope } : {}), page: String(page + 1) })}`}>Older</Link>
        </Button>
      </div>
    </>
  );
}

export default function ActivityPage({ searchParams }: PageProps<"/activity">) {
  return (
    <>
      <PageHeader title="Activity" description="A chronological record of changes across the tasks you can access." />
      <Suspense fallback={<Skeleton className="h-[500px]" />}>
        <ActivityContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
