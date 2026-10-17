"use client";

import { Command } from "cmdk";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon, XIcon } from "lucide-react";
import * as React from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

export type Option = { value: string; label: string; hint?: string; color?: string };

export function MultiSelect({
  id,
  options,
  value,
  onChange,
  placeholder = "Select…",
  emptyText = "Nothing found.",
  onCreate,
  disabled,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  onCreate?: (label: string) => Promise<Option | null>;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const selected = options.filter((o) => value.includes(o.value));
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const canCreate =
    onCreate && search.trim() && !options.some((o) => o.label.toLowerCase() === search.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          className="flex min-h-9 w-full items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1 text-left text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:opacity-50"
        >
          <span className="flex flex-1 flex-wrap gap-1">
            {selected.length === 0 ? <span className="px-1 text-muted-foreground">{placeholder}</span> : null}
            {selected.map((o) => (
              <span
                key={o.value}
                className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs"
              >
                {o.color ? <span className="size-2 rounded-full" style={{ background: o.color }} /> : null}
                {o.label}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Remove ${o.label}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggle(o.value);
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-3" />
                </span>
              </span>
            ))}
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-60 p-0">
        <Command className="flex flex-col">
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Search…"
            className="h-9 border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-60 overflow-y-auto p-1">
            <Command.Empty className="px-2 py-3 text-center text-sm text-muted-foreground">
              {canCreate ? null : emptyText}
            </Command.Empty>
            {options.map((o) => (
              <Command.Item
                key={o.value}
                value={`${o.label} ${o.hint ?? ""}`}
                onSelect={() => toggle(o.value)}
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
              >
                <CheckIcon className={cn("size-4", value.includes(o.value) ? "opacity-100" : "opacity-0")} />
                {o.color ? <span className="size-2.5 rounded-full" style={{ background: o.color }} /> : null}
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint ? <span className="truncate text-xs text-muted-foreground">{o.hint}</span> : null}
              </Command.Item>
            ))}
            {canCreate ? (
              <Command.Item
                value={`__create ${search}`}
                disabled={creating}
                onSelect={async () => {
                  setCreating(true);
                  const created = await onCreate!(search.trim());
                  setCreating(false);
                  if (created) {
                    onChange([...value, created.value]);
                    setSearch("");
                  }
                }}
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
              >
                <PlusIcon className="size-4" />
                Create “{search.trim()}”
              </Command.Item>
            ) : null}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
