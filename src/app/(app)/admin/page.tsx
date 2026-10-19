import type { Metadata } from "next";
import { Suspense } from "react";

import { InviteButton, MembersTable, type MemberRow } from "@/components/admin/admin-components";
import { Skeleton } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin · Members" };

async function Members() {
  const viewer = await requireRole(["admin"]);
  const supabase = await createClient();
  const [{ data: members, error }, { data: departments }, { data: pending }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select(
        "user_id, role, department_id, reports_to, is_active, joined_at, deactivated_at, profiles!workspace_members_user_id_fkey(full_name, email, job_title)",
      )
      .eq("workspace_id", viewer.workspaceId)
      .order("joined_at"),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("invitations").select("accepted_user_id").eq("status", "pending").not("accepted_user_id", "is", null),
  ]);
  if (error) throw new Error(`Could not load members: ${error.message}`);
  const pendingIds = new Set((pending ?? []).map((p) => p.accepted_user_id));
  const rows: MemberRow[] = (members ?? []).map((m) => ({
    user_id: m.user_id,
    full_name: m.profiles?.full_name ?? "",
    email: m.profiles?.email ?? "",
    job_title: m.profiles?.job_title ?? null,
    role: m.role,
    department_id: m.department_id,
    reports_to: m.reports_to,
    is_active: m.is_active,
    joined_at: m.joined_at,
    pending_invite: pendingIds.has(m.user_id),
    // Never activated (self sign-up with approval required), as opposed to deactivated later.
    awaiting_approval: !m.is_active && m.deactivated_at === null,
  }));
  rows.sort(
    (a, b) =>
      Number(b.awaiting_approval) - Number(a.awaiting_approval) ||
      Number(b.is_active) - Number(a.is_active) ||
      (a.full_name || a.email).localeCompare(b.full_name || b.email),
  );
  const active = rows.filter((r) => r.is_active).length;
  const awaiting = rows.filter((r) => r.awaiting_approval).length;

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {active} active · {awaiting ? `${awaiting} awaiting approval · ` : ""}
          {rows.length - active - awaiting} deactivated. Deactivated members lose all access immediately and can&apos;t
          sign in. Use <strong>Reports to</strong> to choose each person&apos;s manager: managers see the tasks and
          activity of the people who report to them; everyone else sees only their own.
        </p>
        <InviteButton departments={departments ?? []} />
      </div>
      <MembersTable members={rows} departments={departments ?? []} viewerId={viewer.id} />
    </>
  );
}

export default function AdminMembersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Members />
    </Suspense>
  );
}
