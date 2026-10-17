"use client";

import { LogOutIcon, SettingsIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";

import { signOut } from "@/app/(auth)/actions";
import type { ShellViewer } from "@/components/layout/app-shell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/primitives";
import { ROLE_LABEL } from "@/lib/tasks/constants";

export function UserMenu({ viewer }: { viewer: ShellViewer }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        aria-label="Account menu"
      >
        <UserAvatar name={viewer.fullName} id={viewer.id} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium text-foreground">{viewer.fullName}</div>
          <div className="truncate text-xs">{viewer.email}</div>
          <div className="mt-1 text-xs">{ROLE_LABEL[viewer.role]}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <SettingsIcon /> Profile & settings
          </Link>
        </DropdownMenuItem>
        {viewer.role === "admin" ? (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <ShieldCheckIcon /> Admin panel
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <form action={signOut}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOutIcon /> Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
