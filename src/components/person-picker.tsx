"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { NativeSelect } from "@/components/ui/input";

/** Chooses whose tasks and activity a page shows; writes ?person= to the URL. */
export function PersonPicker({ current, options }: { current: string; options: { value: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (options.length === 0) return null;

  return (
    <NativeSelect
      aria-label="Whose tasks to show"
      className="h-8 w-auto max-w-48 text-sm"
      value={current}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        // The first option is the page's default view.
        if (e.target.value === options[0].value) next.delete("person");
        else next.set("person", e.target.value);
        next.delete("page");
        router.replace(`${pathname}?${next}`, { scroll: false });
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}
