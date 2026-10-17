import Link from "next/link";

import { LocalDateTime } from "@/components/time";
import { UserAvatar } from "@/components/ui/primitives";
import { actorName, describeActivity, isSelfDescribing, type ActivityEvent } from "@/lib/activity";
import { cn } from "@/lib/utils";

/**
 * Chronological, human-readable activity list, e.g.
 * "Rahul changed the status from To do to In progress — Today, 11:05 AM".
 */
export function ActivityTimeline({
  events,
  showTask = false,
  emptyText = "No activity yet.",
  className,
}: {
  events: ActivityEvent[];
  showTask?: boolean;
  emptyText?: string;
  className?: string;
}) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ol className={cn("relative grid gap-3 border-l pl-5", className)}>
      {events.map((e) => {
        const subject = showTask && e.task ? e.task.key : "this task";
        const phrase = describeActivity(e, subject);
        return (
          <li key={e.id} className="relative">
            <span className="absolute top-0.5 -left-[31px] rounded-full bg-background p-0.5">
              <UserAvatar size="xs" name={actorName(e)} id={e.actor?.id} />
            </span>
            <p className="text-sm">
              {isSelfDescribing(e.event_type) ? (
                <>{phrase.charAt(0).toUpperCase() + phrase.slice(1)}</>
              ) : (
                <>
                  <span className="font-medium">{actorName(e)}</span> {phrase}
                </>
              )}
              {typeof e.metadata?.note === "string" ? (
                <span className="text-muted-foreground"> — “{e.metadata.note}”</span>
              ) : null}
              <span className="text-muted-foreground">
                {" — "}
                <LocalDateTime iso={e.created_at} />
              </span>
            </p>
            {showTask && e.task ? (
              <Link
                href={`/tasks/${e.task.key}`}
                className="text-xs text-muted-foreground hover:text-primary hover:underline"
              >
                {e.task.key} · {e.task.title}
              </Link>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
