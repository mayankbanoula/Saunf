import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { ShellSkeleton } from "@/components/layout/shell-skeleton";
import { canCreateTasks, getUserId, requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  // Fetch the badge counts alongside the viewer instead of after it.
  const supabase = await createClient();
  const userId = await getUserId();
  const [viewer, { count }, { data: unreadMessages }] = await Promise.all([
    requireViewer(),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", userId ?? "")
      .is("read_at", null),
    supabase.rpc("unread_conversation_count"),
  ]);

  return (
    <AppShell
      viewer={{
        id: viewer.id,
        fullName: viewer.fullName,
        email: viewer.email,
        role: viewer.role,
        workspaceName: viewer.workspaceName,
        canCreate: canCreateTasks(viewer),
      }}
      unreadCount={count ?? 0}
      unreadMessages={unreadMessages ?? 0}
    >
      {children}
    </AppShell>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}
