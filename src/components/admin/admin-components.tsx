"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Loader2Icon,
  MailIcon,
  PencilIcon,
  PlusIcon,
  RotateCwIcon,
  Trash2Icon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
  deleteDepartment,
  inviteMember,
  resendInvitation,
  revokeInvitation,
  saveDepartment,
  setMemberActive,
  updateMember,
  updateWorkspaceSettings,
} from "@/actions/admin";
import { LocalDateTime } from "@/components/time";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/form";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/overlays";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  UserAvatar,
} from "@/components/ui/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ASSIGNMENT_POLICY_LABEL,
  PRIORITY_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  VISIBILITY_LABEL,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from "@/lib/tasks/constants";
import { cn } from "@/lib/utils";
import { departmentSchema, inviteSchema, settingsSchema } from "@/lib/validation/admin";

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
const ADMIN_TABS = [
  { href: "/admin", label: "Members" },
  { href: "/admin/invitations", label: "Invitations" },
  { href: "/admin/departments", label: "Departments" },
  { href: "/admin/projects", label: "Projects" },
  { href: "/admin/settings", label: "Workspace settings" },
  { href: "/admin/archive", label: "Archived tasks" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b" aria-label="Admin sections">
      {ADMIN_TABS.map((t) => {
        const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

type Dept = { id: string; name: string };

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
export type MemberRow = {
  user_id: string;
  full_name: string;
  email: string;
  job_title: string | null;
  role: WorkspaceRole;
  department_id: string | null;
  is_active: boolean;
  joined_at: string;
  pending_invite: boolean;
};

export function MembersTable({
  members,
  departments,
  viewerId,
}: {
  members: MemberRow[];
  departments: Dept[];
  viewerId: string;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(id);
    const res = await fn();
    setBusy(null);
    if (res.ok) toast.success(success);
    else toast.error(res.error);
  };

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="hidden md:table-cell">Department</TableHead>
            <TableHead className="hidden lg:table-cell">Joined</TableHead>
            <TableHead>Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            const self = m.user_id === viewerId;
            return (
              <TableRow key={m.user_id} className={cn(!m.is_active && "opacity-60")}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <UserAvatar name={m.full_name || m.email} id={m.user_id} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate font-medium">
                        {m.full_name || m.email}
                        {self ? <Badge variant="outline">You</Badge> : null}
                        {m.pending_invite ? <Badge variant="warning">Invite pending</Badge> : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <NativeSelect
                    aria-label={`Role for ${m.full_name}`}
                    className="h-8 w-32 text-sm"
                    value={m.role}
                    disabled={self || busy === m.user_id}
                    onChange={(e) =>
                      run(
                        m.user_id,
                        () => updateMember({ user_id: m.user_id, role: e.target.value as WorkspaceRole }),
                        "Role updated",
                      )
                    }
                  >
                    {WORKSPACE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <NativeSelect
                    aria-label={`Department for ${m.full_name}`}
                    className="h-8 w-40 text-sm"
                    value={m.department_id ?? ""}
                    disabled={busy === m.user_id}
                    onChange={(e) =>
                      run(
                        m.user_id,
                        () => updateMember({ user_id: m.user_id, department_id: e.target.value }),
                        "Department updated",
                      )
                    }
                  >
                    <option value="">No department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                  <LocalDateTime iso={m.joined_at} dateOnly />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      aria-label={m.is_active ? `Deactivate ${m.full_name}` : `Reactivate ${m.full_name}`}
                      checked={m.is_active}
                      disabled={self || busy === m.user_id}
                      onCheckedChange={(checked) => {
                        if (
                          !checked &&
                          !window.confirm(`Deactivate ${m.full_name || m.email}? They will lose access immediately.`)
                        )
                          return;
                        void run(
                          m.user_id,
                          () => setMemberActive(m.user_id, checked),
                          checked ? "Member reactivated" : "Member deactivated",
                        );
                      }}
                    />
                    {busy === m.user_id ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------
type InviteIn = z.input<typeof inviteSchema>;
type InviteOut = z.output<typeof inviteSchema>;

export function InviteButton({ departments }: { departments: Dept[] }) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<InviteIn, unknown, InviteOut>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", full_name: "", role: "employee", department_id: "", mode: "invite", password: "" },
  });
  const mode = useWatch({ control: form.control, name: "mode" });
  const onSubmit = async (values: InviteOut) => {
    setError(null);
    const res = await inviteMember(values);
    if (!res.ok) return setError(res.error);
    toast.success(
      res.data.mode === "invite" ? `Invitation sent to ${values.email}` : `Account created for ${values.email}`,
    );
    form.reset();
    setOpen(false);
  };
  const e = form.formState.errors;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlusIcon /> Add employee
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an employee</DialogTitle>
            <DialogDescription>
              Saunf is invite-only. New members join with the role and department you choose.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <FormError message={error} />
            <Field label="Full name" htmlFor="inv-name" error={e.full_name?.message} required>
              <Input {...form.register("full_name")} autoFocus />
            </Field>
            <Field label="Work email" htmlFor="inv-email" error={e.email?.message} required>
              <Input type="email" {...form.register("email")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Role" htmlFor="inv-role">
                <NativeSelect {...form.register("role")}>
                  {WORKSPACE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Department" htmlFor="inv-dept">
                <NativeSelect {...form.register("department_id")}>
                  <option value="">None</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">How should they get access?</legend>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  value="invite"
                  className="mt-1 accent-[var(--primary)]"
                  {...form.register("mode")}
                />
                <span>
                  Email an invitation{" "}
                  <span className="block text-xs text-muted-foreground">
                    They choose their own password. Requires email (SMTP) to be configured in Supabase.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  value="password"
                  className="mt-1 accent-[var(--primary)]"
                  {...form.register("mode")}
                />
                <span>
                  Create the account with a temporary password{" "}
                  <span className="block text-xs text-muted-foreground">
                    Share it securely; they can change it in Settings.
                  </span>
                </span>
              </label>
            </fieldset>
            {mode === "password" ? (
              <Field label="Temporary password" htmlFor="inv-password" error={e.password?.message}>
                <Input type="text" autoComplete="off" {...form.register("password")} />
              </Field>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : <MailIcon />}
                {mode === "invite" ? "Send invitation" : "Create account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export type InvitationRow = {
  id: string;
  email: string;
  full_name: string;
  role: WorkspaceRole;
  status: "pending" | "accepted" | "revoked";
  created_at: string;
  accepted_at: string | null;
  invited_by: string | null;
};

export function InvitationsTable({ invitations }: { invitations: InvitationRow[] }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(id);
    const res = await fn();
    setBusy(null);
    if (res.ok) toast.success(success);
    else toast.error(res.error);
  };
  if (!invitations.length) return <p className="text-sm text-muted-foreground">No invitations yet.</p>;
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Invitee</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Sent</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.map((i) => (
            <TableRow key={i.id}>
              <TableCell>
                <div className="font-medium">{i.full_name || i.email}</div>
                <div className="text-xs text-muted-foreground">{i.email}</div>
              </TableCell>
              <TableCell>{ROLE_LABEL[i.role]}</TableCell>
              <TableCell>
                <Badge variant={i.status === "pending" ? "warning" : i.status === "accepted" ? "accent" : "secondary"}>
                  {i.status === "pending" ? "Pending" : i.status === "accepted" ? "Accepted" : "Revoked"}
                </Badge>
              </TableCell>
              <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                <LocalDateTime iso={i.created_at} />
              </TableCell>
              <TableCell className="text-right">
                {i.status === "pending" ? (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy === i.id}
                      onClick={() => run(i.id, () => resendInvitation(i.id), "Invitation re-sent")}
                    >
                      <RotateCwIcon /> Resend
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy === i.id}
                      onClick={() =>
                        window.confirm(`Revoke the invitation for ${i.email}?`) &&
                        run(i.id, () => revokeInvitation(i.id), "Invitation revoked")
                      }
                    >
                      <XIcon /> Revoke
                    </Button>
                  </div>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------
export type DepartmentRow = {
  id: string;
  name: string;
  description: string | null;
  manager_id: string | null;
  member_count: number;
};
type DeptIn = z.input<typeof departmentSchema>;
type DeptOut = z.output<typeof departmentSchema>;

function DepartmentDialog({
  open,
  onOpenChange,
  department,
  people,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  department?: DepartmentRow;
  people: { id: string; name: string }[];
}) {
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<DeptIn, unknown, DeptOut>({
    resolver: zodResolver(departmentSchema),
    values: {
      name: department?.name ?? "",
      description: department?.description ?? "",
      manager_id: department?.manager_id ?? "",
    },
  });
  const onSubmit = async (v: DeptOut) => {
    setError(null);
    const res = await saveDepartment(v, department?.id);
    if (!res.ok) return setError(res.error);
    toast.success(department ? "Department updated" : "Department created");
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{department ? "Edit department" : "New department"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <FormError message={error} />
          <Field label="Name" htmlFor="dept-name" error={form.formState.errors.name?.message} required>
            <Input {...form.register("name")} autoFocus />
          </Field>
          <Field label="Description" htmlFor="dept-desc">
            <Textarea rows={2} {...form.register("description")} />
          </Field>
          <Field label="Manager" htmlFor="dept-manager" hint="Managers can view and manage their department's tasks.">
            <NativeSelect {...form.register("manager_id")}>
              <option value="">No manager</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DepartmentsManager({
  departments,
  people,
}: {
  departments: DepartmentRow[];
  people: { id: string; name: string }[];
}) {
  const [editing, setEditing] = React.useState<DepartmentRow | undefined>();
  const [open, setOpen] = React.useState(false);
  const managerName = (id: string | null) => people.find((p) => p.id === id)?.name ?? "—";
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button
          size="sm"
          onClick={() => {
            setEditing(undefined);
            setOpen(true);
          }}
        >
          <PlusIcon /> New department
        </Button>
      </div>
      {departments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No departments yet.</p>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Department</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="font-medium">{d.name}</div>
                    {d.description ? <div className="text-xs text-muted-foreground">{d.description}</div> : null}
                  </TableCell>
                  <TableCell>{managerName(d.manager_id)}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.member_count}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${d.name}`}
                      onClick={() => {
                        setEditing(d);
                        setOpen(true);
                      }}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${d.name}`}
                      onClick={async () => {
                        if (!window.confirm(`Delete ${d.name}? Members and tasks keep working without a department.`))
                          return;
                        const res = await deleteDepartment(d.id);
                        if (res.ok) toast.success("Department deleted");
                        else toast.error(res.error);
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <DepartmentDialog open={open} onOpenChange={setOpen} department={editing} people={people} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Workspace settings
// ---------------------------------------------------------------------------
type SettingsIn = z.input<typeof settingsSchema>;
type SettingsOut = z.output<typeof settingsSchema>;

export function SettingsForm({ initial, timezones }: { initial: SettingsIn; timezones: string[] }) {
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<SettingsIn, unknown, SettingsOut>({
    resolver: zodResolver(settingsSchema),
    defaultValues: initial,
  });
  const { register, formState, setValue, control } = form;
  const flags = {
    employees_can_create_tasks: useWatch({ control, name: "employees_can_create_tasks" }),
    due_reminders_enabled: useWatch({ control, name: "due_reminders_enabled" }),
    email_notifications_enabled: useWatch({ control, name: "email_notifications_enabled" }),
  };
  const onSubmit = async (v: SettingsOut) => {
    setError(null);
    const res = await updateWorkspaceSettings(v);
    if (!res.ok) return setError(res.error);
    toast.success("Settings saved");
    form.reset(v as SettingsIn);
  };
  const toggle = (
    name: "employees_can_create_tasks" | "due_reminders_enabled" | "email_notifications_enabled",
    label: string,
    hint: string,
  ) => (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={name} className="text-sm">
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </label>
      <Switch id={name} checked={!!flags[name]} onCheckedChange={(c) => setValue(name, c, { shouldDirty: true })} />
    </div>
  );

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid max-w-3xl gap-5" noValidate>
      <FormError message={error} />
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Workspace</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Workspace name" htmlFor="workspace_name" error={formState.errors.workspace_name?.message}>
            <Input {...register("workspace_name")} />
          </Field>
          <Field label="Timezone" htmlFor="timezone" hint="Used for “due today”, overdue checks and reminders.">
            <NativeSelect {...register("timezone")}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Task permissions</CardTitle>
            <CardDescription>Enforced by the database for every request, not just hidden in the UI.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {toggle(
            "employees_can_create_tasks",
            "Employees can create tasks",
            "Admins and managers can always create tasks.",
          )}
          <Field label="Assignment policy for employees" htmlFor="assignment_policy">
            <NativeSelect {...register("assignment_policy")}>
              {(["anyone", "department", "self"] as const).map((p) => (
                <option key={p} value={p}>
                  {ASSIGNMENT_POLICY_LABEL[p]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Task visibility for employees"
            htmlFor="task_visibility"
            hint="Private projects are always limited to their members."
          >
            <NativeSelect {...register("task_visibility")}>
              {(["all", "participants"] as const).map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABEL[v]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Defaults</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Default status" htmlFor="default_status">
            <NativeSelect {...register("default_status")}>
              {(["todo", "in_progress", "in_review"] as const).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Default priority" htmlFor="default_priority">
            <NativeSelect {...register("default_priority")}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Notifications & retention</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {toggle(
            "due_reminders_enabled",
            "Due-soon and overdue reminders",
            "Checked every 15 minutes by the database scheduler (pg_cron).",
          )}
          <Field
            label="“Due soon” window (hours)"
            htmlFor="due_soon_hours"
            error={formState.errors.due_soon_hours?.message}
          >
            <Input type="number" min={1} max={168} className="w-32" {...register("due_soon_hours")} />
          </Field>
          {toggle(
            "email_notifications_enabled",
            "Email notifications",
            "Sends notification emails via the email cron endpoint when RESEND_API_KEY is configured. In-app notifications always work.",
          )}
          <Field
            label="Auto-archive completed tasks after (days)"
            htmlFor="auto_archive_done_after_days"
            hint="Leave empty to never auto-archive. Archived tasks keep their full history."
            error={formState.errors.auto_archive_done_after_days?.message}
          >
            <Input type="number" min={1} max={3650} className="w-32" {...register("auto_archive_done_after_days")} />
          </Field>
        </CardContent>
      </Card>
      <div>
        <Button type="submit" disabled={formState.isSubmitting || !formState.isDirty}>
          {formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null} Save settings
        </Button>
      </div>
    </form>
  );
}
