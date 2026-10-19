"use client";

import { MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { Logo } from "@/components/brand";
import { GlobalSearch } from "@/components/layout/global-search";
import { isActive, NAV_SECTIONS } from "@/components/layout/nav-items";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { UserMenu } from "@/components/layout/user-menu";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/overlays";
import type { WorkspaceRole } from "@/lib/tasks/constants";
import { cn } from "@/lib/utils";

export type ShellViewer = {
  id: string;
  fullName: string;
  email: string;
  role: WorkspaceRole;
  workspaceName: string;
  canCreate: boolean;
};

const QuickCreateContext = React.createContext<(defaults?: Parameters<typeof TaskFormDialog>[0]["defaults"]) => void>(
  () => {},
);
export const useQuickCreate = () => React.useContext(QuickCreateContext);

const COLLAPSE_KEY = "saunf.sidebar.collapsed";
const COLLAPSE_EVENT = "saunf:sidebar";

// Sidebar collapse is a per-browser UI preference (not application data).
function subscribeCollapsed(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(COLLAPSE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(COLLAPSE_EVENT, callback);
  };
}
function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell({
  viewer,
  unreadCount,
  unreadMessages,
  children,
}: {
  viewer: ShellViewer;
  unreadCount: number;
  /** Conversations with unread messages, shown as a badge on Messages. */
  unreadMessages: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const collapsed = React.useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [seenPath, setSeenPath] = React.useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setMobileOpen(false);
  }
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createDefaults, setCreateDefaults] = React.useState<Parameters<typeof TaskFormDialog>[0]["defaults"]>();

  const toggleCollapsed = () => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1");
    } catch {}
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  };

  const openCreate = React.useCallback((defaults?: Parameters<typeof TaskFormDialog>[0]["defaults"]) => {
    setCreateDefaults(defaults);
    setCreateOpen(true);
  }, []);

  return (
    <QuickCreateContext value={openCreate}>
      <div className="flex min-h-dvh">
        <aside
          className={cn(
            "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 md:flex",
            collapsed ? "w-[60px]" : "w-60",
          )}
        >
          <div className={cn("flex h-14 items-center border-b px-3", collapsed ? "justify-center" : "justify-between")}>
            <Link href="/dashboard" aria-label="Saunf home">
              <Logo collapsed={collapsed} />
            </Link>
            {!collapsed ? (
              <Button variant="ghost" size="icon-sm" onClick={toggleCollapsed} aria-label="Collapse sidebar">
                <PanelLeftCloseIcon />
              </Button>
            ) : null}
          </div>
          <SidebarNav
            pathname={pathname}
            role={viewer.role}
            collapsed={collapsed}
            badges={{ "/messages": unreadMessages }}
          />
          {collapsed ? (
            <div className="border-t p-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleCollapsed}
                aria-label="Expand sidebar"
                className="w-full"
              >
                <PanelLeftOpenIcon />
              </Button>
            </div>
          ) : (
            <div className="border-t px-4 py-3 text-xs text-muted-foreground">
              <div className="truncate font-medium text-foreground">{viewer.workspaceName}</div>
              Private workspace
            </div>
          )}
        </aside>

        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent aria-describedby={undefined}>
            <DialogTitle className="sr-only">Navigation</DialogTitle>
            <div className="flex h-14 items-center border-b px-4">
              <Logo />
            </div>
            <SidebarNav
              pathname={pathname}
              role={viewer.role}
              collapsed={false}
              badges={{ "/messages": unreadMessages }}
            />
          </SheetContent>
        </Dialog>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-5">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <MenuIcon />
            </Button>
            <GlobalSearch />
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {viewer.canCreate ? (
                <Button size="sm" onClick={() => openCreate()} aria-label="Create task">
                  <PlusIcon />
                  <span className="hidden sm:inline">New task</span>
                </Button>
              ) : null}
              <NotificationsMenu initialUnread={unreadCount} />
              <UserMenu viewer={viewer} />
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6">{children}</main>
        </div>
      </div>
      <TaskFormDialog open={createOpen} onOpenChange={setCreateOpen} defaults={createDefaults} />
    </QuickCreateContext>
  );
}

function SidebarNav({
  pathname,
  role,
  collapsed,
  badges,
}: {
  pathname: string;
  role: WorkspaceRole;
  collapsed: boolean;
  badges: Record<string, number>;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main">
      {NAV_SECTIONS.map((section, i) => (
        <div key={i} className={cn(i > 0 && "mt-4")}>
          {section.title && !collapsed ? (
            <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {section.title}
            </div>
          ) : null}
          <ul className="grid gap-0.5">
            {section.items
              .filter((item) => !item.roles || item.roles.includes(role))
              .map((item) => {
                const active = isActive(pathname, item.href);
                const badge = badges[item.href] ?? 0;
                const link = (
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                      active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <span className="relative">
                      <item.icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                      {badge > 0 && collapsed ? (
                        <span className="absolute -top-1 -right-1 size-2 rounded-full bg-primary" />
                      ) : null}
                    </span>
                    {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
                    {badge > 0 && !collapsed ? (
                      <span
                        className="ml-auto rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground tabular-nums"
                        aria-label={`${badge} unread`}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                );
                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Tooltip content={item.label} side="right">
                        {link}
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
