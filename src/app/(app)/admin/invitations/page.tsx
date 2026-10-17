import type { Metadata } from "next";
import { Suspense } from "react";

import { InvitationsTable, InviteButton, type InvitationRow } from "@/components/admin/admin-components";
import { Skeleton } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin · Invitations" };

async function Invitations() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const [{ data, error }, { data: departments }] = await Promise.all([
    supabase
      .from("invitations")
      .select("id, email, full_name, role, status, created_at, accepted_at, invited_by")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("departments").select("id, name").order("name"),
  ]);
  if (error) throw new Error(`Could not load invitations: ${error.message}`);
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Invitations stay pending until the person sets their password.</p>
        <InviteButton departments={departments ?? []} />
      </div>
      <InvitationsTable invitations={(data ?? []) as InvitationRow[]} />
    </>
  );
}

export default function AdminInvitationsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Invitations />
    </Suspense>
  );
}
