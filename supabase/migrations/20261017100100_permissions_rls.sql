-- Permission helpers (schema `private`, not exposed via the Data API) and RLS.
-- See docs/SECURITY.md for the permission matrix these implement.
--
-- Helpers are SECURITY DEFINER with an empty search_path: they read base tables
-- directly (no RLS recursion) and take the user id explicitly so triggers can
-- evaluate permissions for someone other than the caller (e.g. notification
-- recipients). Policies pass (select auth.uid()) so it is evaluated once.

grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------
create or replace function private.member_role(p_uid uuid, p_ws uuid)
returns public.workspace_role
language sql stable security definer set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = p_ws and m.user_id = p_uid and m.is_active
$$;

create or replace function private.is_member(p_uid uuid, p_ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_uid is not null and private.member_role(p_uid, p_ws) is not null
$$;

create or replace function private.is_admin(p_uid uuid, p_ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.member_role(p_uid, p_ws) = 'admin', false)
$$;

create or replace function private.is_manager_or_admin(p_uid uuid, p_ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.member_role(p_uid, p_ws) in ('admin', 'manager'), false)
$$;

-- The caller's (single) active workspace.
create or replace function private.current_workspace_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.workspace_id
  from public.workspace_members m
  where m.user_id = (select auth.uid()) and m.is_active
  order by m.joined_at
  limit 1
$$;

-- True when both users are active members of a common workspace.
create or replace function private.shares_workspace(p_uid uuid, p_other uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members a
    join public.workspace_members b on b.workspace_id = a.workspace_id
    where a.user_id = p_uid and a.is_active and b.user_id = p_other
  )
$$;

-- Departments a manager is responsible for: those they manage plus their own.
create or replace function private.managed_department_ids(p_uid uuid, p_ws uuid)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct d), '{}')
  from (
    select id as d from public.departments where workspace_id = p_ws and manager_id = p_uid
    union
    select department_id from public.workspace_members
    where workspace_id = p_ws and user_id = p_uid and department_id is not null
  ) s
$$;

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create or replace function private.is_project_member(p_uid uuid, p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.projects p where p.id = p_project and p.owner_id = p_uid)
      or exists (select 1 from public.project_members pm where pm.project_id = p_project and pm.user_id = p_uid)
$$;

create or replace function private.is_project_manager(p_uid uuid, p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.projects p where p.id = p_project and p.owner_id = p_uid)
      or exists (
        select 1 from public.project_members pm
        where pm.project_id = p_project and pm.user_id = p_uid and pm.role = 'lead'
      )
$$;

-- Row variant: used by the SELECT policy so INSERT ... RETURNING works (a lookup by id
-- can't see a row inserted by the same statement).
create or replace function private.can_view_project_row(
  p_uid uuid, p_ws uuid, p_project uuid, p_private boolean, p_owner uuid
)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role public.workspace_role := private.member_role(p_uid, p_ws);
begin
  if v_role is null then
    return false;
  end if;
  return v_role = 'admin' or not p_private or p_owner = p_uid or private.is_project_member(p_uid, p_project);
end;
$$;

create or replace function private.can_view_project(p_uid uuid, p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select private.can_view_project_row(p_uid, p.workspace_id, p.id, p.is_private, p.owner_id)
    from public.projects p where p.id = p_project
  ), false)
$$;

create or replace function private.can_manage_project(p_uid uuid, p_project uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.projects where id = p_project;
  if v_ws is null or not private.is_member(p_uid, v_ws) then
    return false;
  end if;
  return private.is_admin(p_uid, v_ws) or private.is_project_manager(p_uid, p_project);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create or replace function private.in_manager_scope(
  p_uid uuid, p_ws uuid, p_department uuid, p_creator uuid, p_assignee uuid
)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_depts uuid[];
begin
  if private.member_role(p_uid, p_ws) is distinct from 'manager' then
    return false;
  end if;
  v_depts := private.managed_department_ids(p_uid, p_ws);
  if cardinality(v_depts) = 0 then
    return false;
  end if;
  return (p_department is not null and p_department = any (v_depts))
      or exists (
        select 1 from public.workspace_members m
        where m.workspace_id = p_ws
          and m.user_id in (p_creator, p_assignee)
          and m.department_id = any (v_depts)
      );
end;
$$;

create or replace function private.is_task_participant(p_uid uuid, p_task uuid, p_creator uuid, p_assignee uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_uid = p_creator
      or p_uid = p_assignee
      or exists (select 1 from public.task_collaborators c where c.task_id = p_task and c.user_id = p_uid)
$$;

create or replace function private.can_view_task_row(
  p_uid uuid, p_ws uuid, p_task uuid, p_creator uuid, p_assignee uuid, p_department uuid, p_project uuid
)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role public.workspace_role;
  v_private boolean;
  v_visibility public.task_visibility;
begin
  v_role := private.member_role(p_uid, p_ws);
  if v_role is null then
    return false;
  end if;
  if v_role = 'admin' then
    return true;
  end if;
  if private.is_task_participant(p_uid, p_task, p_creator, p_assignee) then
    return true;
  end if;
  if p_project is not null then
    if private.is_project_member(p_uid, p_project) then
      return true;
    end if;
    select is_private into v_private from public.projects where id = p_project;
    if coalesce(v_private, false) then
      return false;
    end if;
  end if;
  if private.in_manager_scope(p_uid, p_ws, p_department, p_creator, p_assignee) then
    return true;
  end if;
  select task_visibility into v_visibility from public.workspace_settings where workspace_id = p_ws;
  return coalesce(v_visibility, 'all') = 'all';
end;
$$;

create or replace function private.can_view_task(p_uid uuid, p_task uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select private.can_view_task_row(p_uid, t.workspace_id, t.id, t.creator_id, t.assignee_id, t.department_id, t.project_id)
    from public.tasks t where t.id = p_task
  ), false)
$$;

-- Task editor: admin, creator, manager in scope, project manager.
create or replace function private.can_edit_task(p_uid uuid, p_task uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  t record;
  v_role public.workspace_role;
begin
  select workspace_id, creator_id, assignee_id, department_id, project_id
    into t from public.tasks where id = p_task;
  if not found then
    return false;
  end if;
  v_role := private.member_role(p_uid, t.workspace_id);
  if v_role is null then
    return false;
  end if;
  if v_role = 'admin' or t.creator_id = p_uid then
    return true;
  end if;
  if t.project_id is not null and private.is_project_manager(p_uid, t.project_id) then
    return true;
  end if;
  return private.in_manager_scope(p_uid, t.workspace_id, t.department_id, t.creator_id, t.assignee_id)
     and private.can_view_task(p_uid, p_task);
end;
$$;

-- Task worker: editor, assignee or collaborator.
create or replace function private.can_work_task(p_uid uuid, p_task uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  t record;
begin
  select workspace_id, creator_id, assignee_id into t from public.tasks where id = p_task;
  if not found or not private.is_member(p_uid, t.workspace_id) then
    return false;
  end if;
  return private.is_task_participant(p_uid, p_task, t.creator_id, t.assignee_id)
      or private.can_edit_task(p_uid, p_task);
end;
$$;

create or replace function private.task_is_archived(p_task uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select archived_at is not null from public.tasks where id = p_task), true)
$$;

create or replace function private.can_create_task(p_uid uuid, p_ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case private.member_role(p_uid, p_ws)
    when 'admin' then true
    when 'manager' then true
    when 'employee' then coalesce(
      (select employees_can_create_tasks from public.workspace_settings where workspace_id = p_ws), false)
    else false
  end
$$;

-- May p_uid assign work to p_target (NULL = unassigned) in p_ws?
create or replace function private.can_assign_to(p_uid uuid, p_ws uuid, p_target uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role public.workspace_role;
  v_policy public.assignment_policy;
  v_my_dept uuid;
  v_target_dept uuid;
begin
  v_role := private.member_role(p_uid, p_ws);
  if v_role is null then
    return false;
  end if;
  if p_target is null then
    return true;
  end if;
  if not private.is_member(p_target, p_ws) then
    return false; -- target must be an active member of the same workspace
  end if;
  if v_role in ('admin', 'manager') or p_target = p_uid then
    return true;
  end if;
  select assignment_policy into v_policy from public.workspace_settings where workspace_id = p_ws;
  v_policy := coalesce(v_policy, 'anyone');
  if v_policy = 'anyone' then
    return true;
  elsif v_policy = 'department' then
    select department_id into v_my_dept from public.workspace_members where workspace_id = p_ws and user_id = p_uid;
    select department_id into v_target_dept from public.workspace_members where workspace_id = p_ws and user_id = p_target;
    return v_my_dept is not null and v_my_dept = v_target_dept;
  end if;
  return false; -- 'self'
end;
$$;

-- Parse a storage object path "<workspace_id>/<task_id>/<file>" safely.
create or replace function private.storage_path_task_id(p_name text)
returns uuid
language plpgsql immutable set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if cardinality(v_parts) <> 3 then
    return null;
  end if;
  return v_parts[2]::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function private.storage_path_matches_task(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = private.storage_path_task_id(p_name)
      and split_part(p_name, '/', 1) = t.workspace_id::text
  )
$$;

-- ---------------------------------------------------------------------------
-- Grants: deny by default, then grant what policies allow.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

revoke insert, update, delete, truncate on all tables in schema public from authenticated;

grant insert on public.departments, public.invitations, public.projects, public.project_members,
  public.task_collaborators, public.labels, public.task_labels, public.task_dependencies,
  public.task_comments, public.task_attachments, public.tasks
  to authenticated;
grant delete on public.departments, public.project_members, public.task_collaborators,
  public.labels, public.task_labels, public.task_dependencies, public.task_attachments
  to authenticated;

-- Column-level UPDATE grants restrict which fields can ever be written.
grant update (name) on public.workspaces to authenticated;
grant update (employees_can_create_tasks, assignment_policy, task_visibility, default_status,
  default_priority, timezone, due_soon_hours, due_reminders_enabled, email_notifications_enabled,
  auto_archive_done_after_days) on public.workspace_settings to authenticated;
grant update (full_name, job_title, avatar_url, email_notifications) on public.profiles to authenticated;
grant update (role, department_id, is_active) on public.workspace_members to authenticated;
grant update (name, description, manager_id) on public.departments to authenticated;
grant update (status) on public.invitations to authenticated;
grant update (name, description, owner_id, status, start_date, target_date, is_private, archived_at)
  on public.projects to authenticated;
grant update (role) on public.project_members to authenticated;
grant update (title, description, status, priority, progress, project_id, department_id, parent_id,
  assignee_id, start_date, due_date, due_time, estimate_hours, is_blocked, blocker_description, archived_at)
  on public.tasks to authenticated;
grant update (name, color) on public.labels to authenticated;
grant update (body, deleted_at) on public.task_comments to authenticated;
grant update (read_at) on public.notifications to authenticated;
-- activity_events and task_assignments: SELECT only (written by triggers).

-- Supabase grants new objects to anon/authenticated by default; stop that for this schema
-- so future tables are private until explicitly granted.
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invitations enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_collaborators enable row level security;
alter table public.task_assignments enable row level security;
alter table public.labels enable row level security;
alter table public.task_labels enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_attachments enable row level security;
alter table public.activity_events enable row level security;
alter table public.notifications enable row level security;

-- workspaces
create policy "members read their workspace" on public.workspaces
  for select to authenticated using (private.is_member((select auth.uid()), id));
create policy "admins update workspace" on public.workspaces
  for update to authenticated
  using (private.is_admin((select auth.uid()), id))
  with check (private.is_admin((select auth.uid()), id));

-- workspace_settings
create policy "members read settings" on public.workspace_settings
  for select to authenticated using (private.is_member((select auth.uid()), workspace_id));
create policy "admins update settings" on public.workspace_settings
  for update to authenticated
  using (private.is_admin((select auth.uid()), workspace_id))
  with check (private.is_admin((select auth.uid()), workspace_id));

-- profiles
create policy "read own profile and colleagues" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_workspace((select auth.uid()), id));
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- departments
create policy "members read departments" on public.departments
  for select to authenticated using (private.is_member((select auth.uid()), workspace_id));
create policy "admins insert departments" on public.departments
  for insert to authenticated with check (private.is_admin((select auth.uid()), workspace_id));
create policy "admins update departments" on public.departments
  for update to authenticated
  using (private.is_admin((select auth.uid()), workspace_id))
  with check (private.is_admin((select auth.uid()), workspace_id));
create policy "admins delete departments" on public.departments
  for delete to authenticated using (private.is_admin((select auth.uid()), workspace_id));

-- workspace_members
create policy "read own membership" on public.workspace_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy "members read directory" on public.workspace_members
  for select to authenticated using (private.is_member((select auth.uid()), workspace_id));
create policy "admins update members" on public.workspace_members
  for update to authenticated
  using (private.is_admin((select auth.uid()), workspace_id))
  with check (private.is_admin((select auth.uid()), workspace_id));

-- invitations
create policy "admins read invitations" on public.invitations
  for select to authenticated using (private.is_admin((select auth.uid()), workspace_id));
create policy "admins create invitations" on public.invitations
  for insert to authenticated
  with check (private.is_admin((select auth.uid()), workspace_id) and status = 'pending');
create policy "admins update invitations" on public.invitations
  for update to authenticated
  using (private.is_admin((select auth.uid()), workspace_id))
  with check (private.is_admin((select auth.uid()), workspace_id));

-- projects
create policy "read visible projects" on public.projects
  for select to authenticated
  using (private.can_view_project_row((select auth.uid()), workspace_id, id, is_private, owner_id));
create policy "managers create projects" on public.projects
  for insert to authenticated
  with check (private.is_manager_or_admin((select auth.uid()), workspace_id));
create policy "project managers update projects" on public.projects
  for update to authenticated
  using (private.can_manage_project((select auth.uid()), id))
  with check (private.is_member((select auth.uid()), workspace_id));

-- project_members
create policy "read members of visible projects" on public.project_members
  for select to authenticated using (private.can_view_project((select auth.uid()), project_id));
create policy "project managers add members" on public.project_members
  for insert to authenticated with check (private.can_manage_project((select auth.uid()), project_id));
create policy "project managers update members" on public.project_members
  for update to authenticated
  using (private.can_manage_project((select auth.uid()), project_id))
  with check (private.can_manage_project((select auth.uid()), project_id));
create policy "project managers remove members" on public.project_members
  for delete to authenticated using (private.can_manage_project((select auth.uid()), project_id));

-- tasks
create policy "read visible tasks" on public.tasks
  for select to authenticated
  using (private.can_view_task_row((select auth.uid()), workspace_id, id, creator_id, assignee_id, department_id, project_id));
create policy "create tasks" on public.tasks
  for insert to authenticated
  with check (
    creator_id = (select auth.uid())
    and private.can_create_task((select auth.uid()), workspace_id)
    and private.can_assign_to((select auth.uid()), workspace_id, assignee_id)
  );
-- Field-level rules are enforced by the tasks_before_update trigger.
create policy "workers update tasks" on public.tasks
  for update to authenticated
  using (private.can_work_task((select auth.uid()), id))
  with check (private.is_member((select auth.uid()), workspace_id));

-- task_collaborators
create policy "read collaborators" on public.task_collaborators
  for select to authenticated using (private.can_view_task((select auth.uid()), task_id));
create policy "editors add collaborators" on public.task_collaborators
  for insert to authenticated
  with check (
    private.can_edit_task((select auth.uid()), task_id)
    and not private.task_is_archived(task_id)
    and private.is_member(user_id, workspace_id)
  );
create policy "editors remove collaborators" on public.task_collaborators
  for delete to authenticated
  using (private.can_edit_task((select auth.uid()), task_id) and not private.task_is_archived(task_id));

-- task_assignments (history; trigger-written)
create policy "read assignment history" on public.task_assignments
  for select to authenticated using (private.can_view_task((select auth.uid()), task_id));

-- labels
create policy "members read labels" on public.labels
  for select to authenticated using (private.is_member((select auth.uid()), workspace_id));
create policy "members create labels" on public.labels
  for insert to authenticated
  with check (private.is_member((select auth.uid()), workspace_id) and created_by = (select auth.uid()));
create policy "managers update labels" on public.labels
  for update to authenticated
  using (private.is_manager_or_admin((select auth.uid()), workspace_id))
  with check (private.is_manager_or_admin((select auth.uid()), workspace_id));
create policy "managers delete labels" on public.labels
  for delete to authenticated using (private.is_manager_or_admin((select auth.uid()), workspace_id));

-- task_labels
create policy "read task labels" on public.task_labels
  for select to authenticated using (private.can_view_task((select auth.uid()), task_id));
create policy "editors add task labels" on public.task_labels
  for insert to authenticated
  with check (private.can_edit_task((select auth.uid()), task_id) and not private.task_is_archived(task_id));
create policy "editors remove task labels" on public.task_labels
  for delete to authenticated
  using (private.can_edit_task((select auth.uid()), task_id) and not private.task_is_archived(task_id));

-- task_dependencies
create policy "read dependencies" on public.task_dependencies
  for select to authenticated using (private.can_view_task((select auth.uid()), task_id));
create policy "editors add dependencies" on public.task_dependencies
  for insert to authenticated
  with check (
    private.can_edit_task((select auth.uid()), task_id)
    and private.can_view_task((select auth.uid()), depends_on_task_id)
    and not private.task_is_archived(task_id)
  );
create policy "editors remove dependencies" on public.task_dependencies
  for delete to authenticated using (private.can_edit_task((select auth.uid()), task_id));

-- task_comments
create policy "read comments" on public.task_comments
  for select to authenticated using (private.can_view_task((select auth.uid()), task_id));
create policy "viewers comment" on public.task_comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and private.can_view_task((select auth.uid()), task_id)
    and not private.task_is_archived(task_id)
  );
-- Authors edit/soft-delete their own comments; admins may soft-delete any (trigger enforces which).
create policy "authors and admins update comments" on public.task_comments
  for update to authenticated
  using (
    deleted_at is null
    and (author_id = (select auth.uid()) or private.is_admin((select auth.uid()), workspace_id))
  )
  with check (private.can_view_task((select auth.uid()), task_id));

-- task_attachments
create policy "read attachments" on public.task_attachments
  for select to authenticated using (private.can_view_task((select auth.uid()), task_id));
create policy "viewers attach" on public.task_attachments
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and private.can_view_task((select auth.uid()), task_id)
    and not private.task_is_archived(task_id)
    and storage_path like workspace_id::text || '/' || task_id::text || '/%'
  );
create policy "uploader or editor deletes attachment" on public.task_attachments
  for delete to authenticated
  using (
    uploaded_by = (select auth.uid())
    or private.can_edit_task((select auth.uid()), task_id)
  );

-- activity_events (append-only; trigger-written)
create policy "read activity" on public.activity_events
  for select to authenticated
  using (
    case
      when task_id is not null then private.can_view_task((select auth.uid()), task_id)
      when project_id is not null then private.can_view_project((select auth.uid()), project_id)
      else private.is_admin((select auth.uid()), workspace_id)
    end
  );

-- notifications
create policy "recipients read notifications" on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()));
create policy "recipients mark read" on public.notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));
