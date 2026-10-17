import { BellIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import type { NotificationItem } from "@/actions/notifications";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { MarkAllReadButton, NotificationLink } from "@/components/notifications/notification-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

const PAGE = 30;
type SP = Record<string, string | string[] | undefined>;

async function NotificationsContent({ searchParams }: { searchParams: Promise<SP> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const unreadOnly = sp.filter === "unread";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  let query = supabase
    .from("notifications")
    .select("id, type, created_at, read_at, data, actor:profiles!notifications_actor_id_fkey(id, full_name, email), task:tasks(key)", {
      count: "exact",
    })
    .eq("recipient_id", viewer.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (unreadOnly) query = query.is("read_at", null);
  const { data, count, error } = await query;
  if (error) throw new Error(`Could not load notifications: ${error.message}`);
  const items = (data ?? []) as unknown as NotificationItem[];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex rounded-md border bg-card p-0.5" role="group" aria-label="Filter">
          <Button asChild size="xs" variant={!unreadOnly ? "secondary" : "ghost"}>
            <Link href="/notifications">All</Link>
          </Button>
          <Button asChild size="xs" variant={unreadOnly ? "secondary" : "ghost"}>
            <Link href="/notifications?filter=unread">Unread</Link>
          </Button>
        </div>
        <MarkAllReadButton />
      </div>
      {items.length === 0 ? (
        <EmptyState icon={BellIcon} title={unreadOnly ? "No unread notifications" : "No notifications yet"} description="You'll be notified about assignments, mentions, comments, reviews and deadlines." />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((n) => (
            <li key={n.id}>
              <NotificationLink item={n} />
            </li>
          ))}
        </ul>
      )}
      {pages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <Button asChild variant="outline" size="sm" className={cn(page <= 1 && "invisible")}>
            <Link href={`/notifications?${new URLSearchParams({ ...(unreadOnly ? { filter: "unread" } : {}), page: String(page - 1) })}`}>Newer</Link>
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button asChild variant="outline" size="sm" className={cn(page >= pages && "invisible")}>
            <Link href={`/notifications?${new URLSearchParams({ ...(unreadOnly ? { filter: "unread" } : {}), page: String(page + 1) })}`}>Older</Link>
          </Button>
        </div>
      ) : null}
    </>
  );
}

export default function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  return (
    <>
      <PageHeader title="Notifications" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <NotificationsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
