"use client";

import { CheckCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { markNotificationsRead, type NotificationItem } from "@/actions/notifications";
import { RelativeTime } from "@/components/time";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/primitives";
import { describeNotification } from "@/lib/notifications";
import { cn, displayName } from "@/lib/utils";

export function NotificationLink({ item }: { item: NotificationItem }) {
  const router = useRouter();
  const { text, detail } = describeNotification(item);
  const key = item.task?.key ?? item.data.key;
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50",
        !item.read_at && "bg-accent/40",
      )}
      onClick={async () => {
        if (!item.read_at) await markNotificationsRead([item.id]);
        if (key) router.push(`/tasks/${key}`);
      }}
    >
      <UserAvatar name={item.actor ? displayName(item.actor) : "Saunf"} id={item.actor?.id} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{text}</span>
        {detail ? <span className="block truncate text-sm text-muted-foreground">{detail}</span> : null}
        <RelativeTime iso={item.created_at} className="text-xs text-muted-foreground" />
      </span>
      {!item.read_at ? <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
    </button>
  );
}

export function MarkAllReadButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await markNotificationsRead("all");
          if (!res.ok) toast.error(res.error);
        })
      }
    >
      <CheckCheckIcon /> Mark all as read
    </Button>
  );
}
