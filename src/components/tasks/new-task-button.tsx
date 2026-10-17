"use client";

import { PlusIcon } from "lucide-react";

import { useQuickCreate } from "@/components/layout/app-shell";
import type { TaskFormDefaults } from "@/components/tasks/task-form-dialog";
import { Button } from "@/components/ui/button";

export function NewTaskButton({
  defaults,
  label = "New task",
  variant = "default",
  size = "sm",
}: {
  defaults?: TaskFormDefaults;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "xs" | "default";
}) {
  const openCreate = useQuickCreate();
  return (
    <Button variant={variant} size={size} onClick={() => openCreate(defaults)}>
      <PlusIcon /> {label}
    </Button>
  );
}
