import { Suspense } from "react";

import { AdminNav } from "@/components/admin/admin-components";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";

async function AdminGate({ children }: { children: React.ReactNode }) {
  // Pages check again, and Postgres RLS enforces admin-only access regardless.
  await requireRole(["admin"]);
  return (
    <>
      <PageHeader title="Admin panel" description="Manage people, structure, policies and audit history." />
      <AdminNav />
      {children}
    </>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}
