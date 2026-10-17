"use client";

import { BellIcon, CheckCheckIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { getUnreadCount, listNotifications, markNotificationsRead, type NotificationItem } from "@/actions/notifications";
import { RelativeTime } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { describeNotification } from "@/lib/notifications";
import { cn } from "@/lib/utils";

const POLL_MS = 60_000;

export function NotificationsMenu({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [unread, setUnread] = React.useState(initialUnread);
  const [items, setItems] = React.useState<NotificationItem[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => setUnread(initialUnread), [initialUnread]);

  // Lightweight polling for the badge; the list itself loads when opened.
  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") getUnreadCount().then(setUnread).catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await listNotifications(15);
    setLoading(false);
    if (res.ok) {
      setItems(res.data.items);
      setUnread(res.data.unread);
    } else toast.error(res.error);
  }, []);

  async function openItem(n: NotificationItem) {
    setOpen(false);
    if (!n.read_at) {
      setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null);
      setUnread((u) => Math.max(0, u - 1));
      void markNotificationsRead([n.id]);
    }
    const key = n.task?.key ?? n.data.key;
    if (key) router.push(`/tasks/${key}${n.type === "comment_added" || n.type === "mentioned" ? "#comments" : ""}`);
  }

  async function markAll() {
    const previous = { items, unread };
    setItems((list) => list?.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })) ?? null);
    setUnread(0);
    const res = await markNotificationsRead("all");
    if (!res.ok) {
      setItems(previous.items);
      setUnread(previous.unread);
      toast.error(res.error);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <BellIcon />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <Button variant="ghost" size="xs" onClick={markAll} disabled={!unread}>
            <CheckCheckIcon /> Mark all as read
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && !items ? (
            <div className="flex justify-center p-6">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : items && items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            <ul>
              {items?.map((n) => {
                const { text, detail } = describeNotification(n);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn(
                        "flex w-full gap-2.5 border-b px-3 py-2.5 text-left last:border-0 hover:bg-muted/60",
                        !n.read_at && "bg-accent/40",
                      )}
                    >
                      <span
                        className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm">{text}</span>
                        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
                        <RelativeTime iso={n.created_at} className="text-xs text-muted-foreground" />
                      </span>
                      {!n.read_at ? <span className="sr-only">Unread</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t p-2 text-center">
          <Link href="/notifications" onClick={() => setOpen(false)} className="text-sm text-primary hover:underline">
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
