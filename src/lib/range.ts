import { addDaysIso, dateRangeToTimestamps, nowInTimezone } from "@/lib/dates";

export const RANGE_PRESETS = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
] as const;

export type DateRange = { key: string; label: string; from: string; to: string; fromTs: string; toTs: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Resolve ?range=7d|30d|90d or ?from=&to= into dates in the workspace timezone. */
export function resolveRange(
  params: Record<string, string | string[] | undefined>,
  timezone: string,
  fallback = "30d",
): DateRange {
  const get = (k: string) => (Array.isArray(params[k]) ? params[k]?.[0] : (params[k] as string | undefined));
  const { today } = nowInTimezone(timezone);
  const from = get("from");
  const to = get("to");
  if (from && to && ISO.test(from) && ISO.test(to) && from <= to) {
    const capped = from < addDaysIso(to, -366) ? addDaysIso(to, -366) : from;
    return {
      key: "custom",
      label: `${capped} – ${to}`,
      from: capped,
      to,
      ...dateRangeToTimestamps(capped, to, timezone),
    };
  }
  const preset = RANGE_PRESETS.find((p) => p.key === get("range")) ?? RANGE_PRESETS.find((p) => p.key === fallback)!;
  const start = addDaysIso(today, -(preset.days - 1));
  return {
    key: preset.key,
    label: preset.label,
    from: start,
    to: today,
    ...dateRangeToTimestamps(start, today, timezone),
  };
}
