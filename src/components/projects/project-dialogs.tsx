"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArchiveIcon, ArchiveRestoreIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { addProjectMember, createProject, removeProjectMember, setProjectArchived, updateProject } from "@/actions/projects";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/form";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/primitives";
import { PROJECT_STATUS_LABEL, PROJECT_STATUSES } from "@/lib/tasks/constants";
import { projectSchema } from "@/lib/validation/project";

type In = z.input<typeof projectSchema>;
type Out = z.output<typeof projectSchema>;
type Member = { id: string; name: string };

export type ProjectFormValues = {
  id: string;
  name: string;
  description: string;
  status: Out["status"];
  owner_id: string | null;
  start_date: string | null;
  target_date: string | null;
  is_private: boolean;
};

function ProjectForm({ project, members, onDone }: { project?: ProjectFormValues; members: Member[]; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: project?.name ?? "",
      description: project?.description ?? "",
      status: project?.status ?? "active",
      owner_id: project?.owner_id ?? "",
      start_date: project?.start_date ?? "",
      target_date: project?.target_date ?? "",
      is_private: project?.is_private ?? false,
    },
  });
  const { register, handleSubmit, formState } = form;

  const onSubmit = async (values: Out) => {
    setError(null);
    if (project) {
      const res = await updateProject(project.id, values);
      if (!res.ok) return setError(res.error);
      toast.success("Project updated");
      onDone();
    } else {
      const res = await createProject(values);
      if (!res.ok) return setError(res.error);
      toast.success("Project created");
      onDone();
      router.push(`/projects/${res.data.id}`);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
      <FormError message={error} />
      <Field label="Name" htmlFor="project-name" error={formState.errors.name?.message} required>
        <Input {...register("name")} maxLength={120} autoFocus />
      </Field>
      <Field label="Description" htmlFor="project-description" error={formState.errors.description?.message}>
        <Textarea {...register("description")} rows={3} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Status" htmlFor="project-status">
          <NativeSelect {...register("status")}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Owner" htmlFor="project-owner" hint={!project ? "Defaults to you." : undefined}>
          <NativeSelect {...register("owner_id")}>
            <option value="">{project ? "No owner" : "Me"}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Start date" htmlFor="project-start">
          <Input type="date" {...register("start_date")} />
        </Field>
        <Field label="Target date" htmlFor="project-target" error={formState.errors.target_date?.message}>
          <Input type="date" {...register("target_date")} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...register("is_private")} />
        <span>
          <span className="font-medium">Private project</span>
          <span className="block text-xs text-muted-foreground">
            Only members, the owner and admins can see it and its tasks (task participants still see their own tasks).
          </span>
        </span>
      </label>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
          {project ? "Save" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NewProjectButton({ members }: { members: Member[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon /> New project
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Group related tasks and track their progress together.</DialogDescription>
          </DialogHeader>
          <ProjectForm members={members} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ProjectAdminButtons({ project, members, archived }: { project: ProjectFormValues; members: Member[]; archived: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={archived}>
        <PencilIcon /> Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (!archived && !window.confirm("Archive this project? Its tasks stay available.")) return;
            const res = await setProjectArchived(project.id, !archived);
            if (res.ok) toast.success(archived ? "Project restored" : "Project archived");
            else toast.error(res.error);
          })
        }
      >
        {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />} {archived ? "Restore" : "Archive"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
          </DialogHeader>
          <ProjectForm project={project} members={members} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ProjectMembers({
  projectId,
  members,
  candidates,
  canManage,
}: {
  projectId: string;
  members: { id: string; name: string; role: string; isOwner?: boolean }[];
  candidates: Member[];
  canManage: boolean;
}) {
  const [userId, setUserId] = React.useState("");
  const [role, setRole] = React.useState<"member" | "lead">("member");
  const [pending, start] = React.useTransition();
  const available = candidates.filter((c) => !members.some((m) => m.id === c.id));
  return (
    <div className="grid gap-3">
      <ul className="grid gap-2">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 text-sm">
            <UserAvatar size="sm" name={m.name} id={m.id} />
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            <span className="text-xs text-muted-foreground">{m.isOwner ? "Owner" : m.role === "lead" ? "Lead" : "Member"}</span>
            {canManage && !m.isOwner ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6"
                aria-label={`Remove ${m.name}`}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await removeProjectMember(projectId, m.id);
                    if (!res.ok) toast.error(res.error);
                  })
                }
              >
                <Trash2Icon />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage && available.length ? (
        <div className="flex gap-1.5">
          <NativeSelect aria-label="Add member" className="h-8 text-sm" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Add a member…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Role" className="h-8 w-24 text-sm" value={role} onChange={(e) => setRole(e.target.value as "member" | "lead")}>
            <option value="member">Member</option>
            <option value="lead">Lead</option>
          </NativeSelect>
          <Button
            size="sm"
            variant="outline"
            disabled={!userId || pending}
            onClick={() =>
              start(async () => {
                const res = await addProjectMember(projectId, userId, role);
                if (res.ok) setUserId("");
                else toast.error(res.error);
              })
            }
          >
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
