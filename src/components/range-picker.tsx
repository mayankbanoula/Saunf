"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input, NativeSelect } from "@/components/ui/input";
import { RANGE_PRESETS } from "@/lib/range";

/** Date-range control that writes ?range= or ?from=&to= to the URL. */
export function RangePicker({ current, from, to }: { current: string; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const apply = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        aria-label="Date range"
        className="h-8 w-auto text-sm"
        value={current}
        onChange={(e) =>
          e.target.value === "custom"
            ? apply({ range: null, from, to })
            : apply({ range: e.target.value, from: null, to: null })
        }
      >
        {RANGE_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom range</option>
      </NativeSelect>
      {current === "custom" ? (
        <>
          <Input
            type="date"
            aria-label="From"
            className="h-8 w-auto text-sm"
            value={from}
            max={to}
            onChange={(e) => e.target.value && apply({ range: null, from: e.target.value, to })}
          />
          <Input
            type="date"
            aria-label="To"
            className="h-8 w-auto text-sm"
            value={to}
            min={from}
            onChange={(e) => e.target.value && apply({ range: null, from, to: e.target.value })}
          />
        </>
      ) : null}
    </div>
  );
}
