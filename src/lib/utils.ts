import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string | null | undefined, fallback = "?") {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  return ((parts[0][0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

export function displayName(p: { full_name?: string | null; email?: string | null } | null | undefined) {
  if (!p) return "Unknown";
  return p.full_name?.trim() || p.email || "Unknown";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Escape a user string for use inside a PostgREST `ilike` pattern. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Quote a value for use inside a PostgREST `or(...)` filter string. */
export function pgrstQuote(value: string) {
  return `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}
