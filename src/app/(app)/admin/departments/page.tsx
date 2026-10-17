import type { Metadata } from "next";
import { Suspense } from "react";

import { DepartmentsManager } from "@/components/admin/admin-components";
import { Skeleton } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Departments" };

async function Departments() {
  const viewer = await requireRole(["admin"]);
  const supabase = await createClient();
  const [{ data: departments, error }, { data: members }] = await Promise.all([
    supabase.from("departments").select("id, name, description, manager_id").order("name"),
    supabase
      .from("workspace_members")
      .select("user_id, department_id, profiles!workspace_members_user_id_fkey(full_name, email)")
      .eq("workspace_id", viewer.workspaceId)
      .eq("is_active", true),
  ]);
  if (error) throw new Error(`Could not load departments: ${error.message}`);
  const people = (members ?? []).map((m) => ({ id: m.user_id, name: displayName(m.profiles) })).sort((a, b) => a.name.localeCompare(b.name));
  const rows = (departments ?? []).map((d) => ({ ...d, member_count: (members ?? []).filter((m) => m.department_id === d.id).length }));
  return <DepartmentsManager departments={rows} people={people} />;
}

export default function AdminDepartmentsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Departments />
    </Suspense>
  );
}
