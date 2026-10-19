import {
  ActivityIcon,
  BarChart3Icon,
  CalendarDaysIcon,
  CircleUserRoundIcon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  ListTodoIcon,
  MessageSquareIcon,
  PenLineIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import type { WorkspaceRole } from "@/lib/tasks/constants";

export type NavItem = { href: string; label: string; icon: LucideIcon; roles?: WorkspaceRole[] };

export const NAV_SECTIONS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
      { href: "/my-tasks", label: "My Tasks", icon: CircleUserRoundIcon },
      { href: "/todos", label: "My To-dos", icon: ListChecksIcon },
      { href: "/messages", label: "Messages", icon: MessageSquareIcon },
      { href: "/created-by-me", label: "Created by Me", icon: PenLineIcon },
      { href: "/tasks", label: "All Tasks", icon: ListTodoIcon },
    ],
  },
  {
    title: "Workspace",
    items: [
      { href: "/projects", label: "Projects", icon: FolderKanbanIcon },
      { href: "/team", label: "Team", icon: UsersIcon },
      { href: "/calendar", label: "Calendar", icon: CalendarDaysIcon },
      { href: "/activity", label: "Activity", icon: ActivityIcon },
      { href: "/reports", label: "Reports", icon: BarChart3Icon },
    ],
  },
  {
    items: [
      { href: "/settings", label: "Settings", icon: SettingsIcon },
      { href: "/admin", label: "Admin Panel", icon: ShieldCheckIcon, roles: ["admin"] },
    ],
  },
];

export function isActive(pathname: string, href: string) {
  if (href === "/tasks") return pathname === "/tasks" || (pathname.startsWith("/tasks/") && pathname !== "/tasks/new");
  return pathname === href || pathname.startsWith(`${href}/`);
}
