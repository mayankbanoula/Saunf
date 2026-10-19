import "server-only";

import { cache } from "react";

import type { Viewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/utils";

export type PersonOption = { value: string; label: string };

/**
 * Whose tasks and activity a page shows, chosen with ?person=.
 *  - Admins: everyone (default), or one person.
 *  - Managers: themselves plus their reportees (default), or one of them.
 *  - Employees: only themselves.
 * The database enforces the same scope; this only picks the slice to show.
 */
export type PeopleView = {
  /** Value of ?person= currently in effect ("all", "team", "me" or a user id). */
  current: string;
  /** Options for the picker; empty when there is nothing to choose. */
  options: PersonOption[];
  /** One person selected (for RPC p_member and ?assignee= links), else null. */
  member: string | null;
  /** Assignee/actor ids to filter queries by; null means no filter (admins viewing everyone). */
  ids: string[] | null;
  /** Short description of the selection, e.g. "Your tasks" or "Your team's tasks". */
  label: string;
};

const peopleInScope = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("people_in_scope");
  if (error) throw new Error(`Could not load your team: ${error.message}`);
  return data ?? [];
});

export async function resolvePeopleView(viewer: Viewer, raw: string | string[] | undefined): Promise<PeopleView> {
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const people = (await peopleInScope()).filter((p) => p.user_id !== viewer.id);
  const me: PeopleView = { current: "me", options: [], member: viewer.id, ids: [viewer.id], label: "Your tasks" };

  if (viewer.role === "employee" || (viewer.role === "manager" && people.length === 0)) return me;

  const group =
    viewer.role === "admin"
      ? { value: "all", label: "Everyone", ids: null, view: "Everyone's tasks" }
      : {
          value: "team",
          label: "My team",
          ids: [viewer.id, ...people.map((p) => p.user_id)],
          view: "Your team's tasks",
        };
  const options: PersonOption[] = [
    { value: group.value, label: group.label },
    { value: "me", label: "Only me" },
    ...people.map((p) => ({ value: p.user_id, label: displayName(p) })),
  ];

  if (requested === "me") return { ...me, options };
  const person = people.find((p) => p.user_id === requested);
  if (person) {
    return {
      current: person.user_id,
      options,
      member: person.user_id,
      ids: [person.user_id],
      label: `${displayName(person)}'s tasks`,
    };
  }
  return { current: group.value, options, member: null, ids: group.ids, label: group.view };
}

/** ?assignee= value matching the view, for links into the task list. */
export function assigneeParam(view: PeopleView, viewer: Viewer) {
  if (!view.member) return "";
  return `&assignee=${view.member === viewer.id ? "me" : view.member}`;
}

/**
 * The person to narrow to, read straight from ?person= so data queries can start
 * without waiting for resolvePeopleView. The database never widens scope for an
 * out-of-reach id (it just returns nothing), so this is safe to pass as p_member.
 */
export function requestedMember(viewer: Viewer, raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "me") return viewer.id;
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
}
