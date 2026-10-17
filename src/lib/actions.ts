import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";
import type { z } from "zod";

import { ActionError } from "@/lib/auth/session";

export type ActionResult<T = null> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string, fieldErrors?: Record<string, string[] | undefined>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

export function validationFailure(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  const first = error.issues[0]?.message ?? "Invalid input";
  return { ok: false, error: first, fieldErrors };
}

/**
 * Translate a database error into a message that is safe to show. Messages raised
 * by our own triggers (errcode 42501 / 23514 / 22023) are written for end users.
 */
export function dbErrorMessage(error: PostgrestError | { message: string; code?: string }): string {
  const code = "code" in error ? error.code : undefined;
  switch (code) {
    case "42501":
      return error.message.includes("row-level security") ? "You do not have permission to do that." : error.message;
    case "23514":
    case "22023":
    case "P0002":
      return error.message.includes("violates check constraint") ? "Some values are not valid." : error.message;
    case "23505":
      return "That already exists.";
    case "23503":
      return "A referenced record no longer exists or belongs to another workspace.";
    case "22P02":
      return "Some values are not valid.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/** Run an action body, converting thrown errors to ActionResult and logging unexpected ones. */
export async function runAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ActionError) return fail(e.message);
    // Let Next.js navigation signals (redirect/notFound) propagate.
    if (e && typeof e === "object" && "digest" in e && typeof (e as { digest: unknown }).digest === "string") {
      const digest = (e as { digest: string }).digest;
      if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) throw e;
    }
    console.error("[action] unexpected error", e);
    return fail("Something went wrong. Please try again.");
  }
}

/** Accept only same-origin relative paths for post-login redirects. */
export function safeNextPath(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
