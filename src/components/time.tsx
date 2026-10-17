"use client";

import { format, formatDistanceToNowStrict, isSameYear, isToday, isYesterday } from "date-fns";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
/** True after hydration; timestamps are then shown in the viewer's local timezone. */
function useIsClient() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

function fallback(iso: string) {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Absolute local date/time, e.g. "Today, 10:30 AM" or "3 Oct, 4:20 PM". */
export function LocalDateTime({ iso, className, dateOnly = false }: { iso: string; className?: string; dateOnly?: boolean }) {
  const client = useIsClient();
  const d = new Date(iso);
  let label = fallback(iso);
  if (client) {
    const time = format(d, "h:mm a");
    const day = isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, isSameYear(d, new Date()) ? "d MMM" : "d MMM yyyy");
    label = dateOnly ? day : `${day}, ${time}`;
  }
  return (
    <time dateTime={iso} className={className} title={client ? format(d, "PPpp") : undefined}>
      {label}
    </time>
  );
}

/** Just the local time, e.g. "10:30 AM". */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const client = useIsClient();
  return (
    <time dateTime={iso} className={className} title={client ? format(new Date(iso), "PPpp") : undefined}>
      {client ? format(new Date(iso), "h:mm a") : iso.slice(11, 16)}
    </time>
  );
}

/** Relative time, e.g. "5 minutes ago". */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const client = useIsClient();
  const d = new Date(iso);
  return (
    <time dateTime={iso} className={className} title={client ? format(d, "PPpp") : undefined}>
      {client ? formatDistanceToNowStrict(d, { addSuffix: true }) : fallback(iso)}
    </time>
  );
}
