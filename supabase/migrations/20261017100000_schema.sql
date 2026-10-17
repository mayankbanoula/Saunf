-- Saunf core schema: enums, tables, constraints, indexes.
-- RLS, permission helpers, triggers and RPCs live in the following migrations.

create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.workspace_role as enum ('admin', 'manager', 'employee');
create type public.task_status as enum ('todo', 'in_progress', 'in_review', 'done');
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.project_status as enum ('planning', 'active', 'on_hold', 'completed', 'cancelled');
create type public.assignment_policy as enum ('anyone', 'department', 'self');
create type public.task_visibility as enum ('all', 'participants');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked');
create type public.notification_type as enum (
  'task_assigned',
  'task_reassigned',
  'collaborator_added',
  'comment_added',
  'mentioned',
  'task_due_soon',
  'task_overdue',
  'task_completed',
  'task_reopened',
  'review_requested'
);

-- ---------------------------------------------------------------------------
-- Workspaces
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  task_prefix text not null default 'SAU' check (task_prefix ~ '^[A-Z]{2,6}$'),
  -- Incremented with UPDATE ... RETURNING inside the task insert trigger.
  task_counter bigint not null default 0 check (task_counter >= 0),
  created_at timestamptz not null default now()
);

create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  employees_can_create_tasks boolean not null default true,
  assignment_policy public.assignment_policy not null default 'anyone',
  task_visibility public.task_visibility not null default 'all',
  default_status public.task_status not null default 'todo' check (default_status <> 'done'),
  default_priority public.task_priority not null default 'medium',
  timezone text not null default 'UTC',
  due_soon_hours integer not null default 24 check (due_soon_hours between 1 and 168),
  due_reminders_enabled boolean not null default true,
  email_notifications_enabled boolean not null default false,
  auto_archive_done_after_days integer check (auto_archive_done_after_days between 1 and 3650),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 120),
  job_title text check (char_length(job_title) <= 120),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  email_notifications boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));
create index profiles_name_trgm_idx on public.profiles using gin (lower(full_name) extensions.gin_trgm_ops);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (char_length(description) <= 1000),
  manager_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index departments_name_uniq on public.departments (workspace_id, lower(name));
create index departments_manager_idx on public.departments (manager_id);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.workspace_role not null default 'employee',
  department_id uuid,
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  deactivated_at timestamptz,
  deactivated_by uuid references public.profiles (id) on delete set null,
  primary key (workspace_id, user_id),
  foreign key (workspace_id, department_id)
    references public.departments (workspace_id, id) on delete set null (department_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);
create index workspace_members_department_idx on public.workspace_members (department_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text not null default '' check (char_length(full_name) <= 120),
  role public.workspace_role not null default 'employee',
  department_id uuid,
  invited_by uuid references public.profiles (id) on delete set null,
  status public.invitation_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_user_id uuid references public.profiles (id) on delete set null,
  foreign key (workspace_id, department_id)
    references public.departments (workspace_id, id) on delete set null (department_id)
);
create unique index invitations_pending_email_uniq
  on public.invitations (workspace_id, email) where status = 'pending';
create index invitations_email_idx on public.invitations (email);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 5000),
  owner_id uuid,
  status public.project_status not null default 'active',
  start_date date,
  target_date date,
  is_private boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  check (target_date is null or start_date is null or target_date >= start_date),
  foreign key (workspace_id, owner_id)
    references public.workspace_members (workspace_id, user_id) on delete set null (owner_id),
  constraint projects_owner_profile_fkey foreign key (owner_id) references public.profiles (id) on delete set null
);
create unique index projects_name_uniq on public.projects (workspace_id, lower(name)) where archived_at is null;
create index projects_owner_idx on public.projects (owner_id);

create table public.project_members (
  project_id uuid not null,
  user_id uuid not null,
  workspace_id uuid not null,
  role text not null default 'member' check (role in ('lead', 'member')),
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade,
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade,
  constraint project_members_profile_fkey foreign key (user_id) references public.profiles (id) on delete cascade
);
create index project_members_user_idx on public.project_members (user_id);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  number bigint not null,
  key text not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 20000),
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  progress smallint not null default 0 check (progress between 0 and 100),
  project_id uuid,
  department_id uuid,
  parent_id uuid,
  creator_id uuid,
  assignee_id uuid,
  assigned_at timestamptz,
  assigned_by uuid references public.profiles (id) on delete set null,
  start_date date,
  due_date date,
  due_time time,
  estimate_hours numeric(7, 2) check (estimate_hours is null or (estimate_hours > 0 and estimate_hours <= 10000)),
  is_blocked boolean not null default false,
  blocker_description text check (char_length(blocker_description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  search_text text generated always as (lower(key || ' ' || title || ' ' || description)) stored,
  unique (workspace_id, number),
  unique (workspace_id, key),
  unique (workspace_id, id),
  check (due_date is null or start_date is null or due_date >= start_date),
  check (due_time is null or due_date is not null),
  check (parent_id is null or parent_id <> id),
  check ((status = 'done') = (completed_at is not null)),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete set null (project_id),
  foreign key (workspace_id, department_id) references public.departments (workspace_id, id) on delete set null (department_id),
  foreign key (workspace_id, parent_id) references public.tasks (workspace_id, id) on delete set null (parent_id),
  foreign key (workspace_id, creator_id) references public.workspace_members (workspace_id, user_id) on delete set null (creator_id),
  foreign key (workspace_id, assignee_id) references public.workspace_members (workspace_id, user_id) on delete set null (assignee_id),
  -- Direct profile FKs so the Data API can embed people (the composite FKs above
  -- guarantee they are members of the same workspace).
  constraint tasks_assignee_profile_fkey foreign key (assignee_id) references public.profiles (id) on delete set null,
  constraint tasks_creator_profile_fkey foreign key (creator_id) references public.profiles (id) on delete set null
);
create index tasks_open_status_idx on public.tasks (workspace_id, status) where archived_at is null;
create index tasks_assignee_idx on public.tasks (assignee_id) where archived_at is null;
create index tasks_creator_idx on public.tasks (creator_id);
create index tasks_project_idx on public.tasks (project_id);
create index tasks_department_idx on public.tasks (department_id);
create index tasks_parent_idx on public.tasks (parent_id);
create index tasks_due_idx on public.tasks (workspace_id, due_date) where archived_at is null and status <> 'done';
create index tasks_updated_idx on public.tasks (workspace_id, updated_at desc);
create index tasks_created_idx on public.tasks (workspace_id, created_at desc);
create index tasks_completed_idx on public.tasks (workspace_id, completed_at) where completed_at is not null;
create index tasks_search_trgm_idx on public.tasks using gin (search_text extensions.gin_trgm_ops);

create table public.task_collaborators (
  task_id uuid not null,
  user_id uuid not null,
  workspace_id uuid not null,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (task_id, user_id),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id) on delete cascade,
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade,
  constraint task_collaborators_profile_fkey foreign key (user_id) references public.profiles (id) on delete cascade
);
create index task_collaborators_user_idx on public.task_collaborators (user_id);

-- Complete assignment history (append-only).
create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  previous_assignee_id uuid references public.profiles (id) on delete set null,
  new_assignee_id uuid references public.profiles (id) on delete set null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default clock_timestamp(),
  note text check (char_length(note) <= 500),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id) on delete cascade
);
create index task_assignments_task_idx on public.task_assignments (task_id, changed_at);

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default '#4d7c5a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index labels_name_uniq on public.labels (workspace_id, lower(name));

create table public.task_labels (
  task_id uuid not null,
  label_id uuid not null,
  workspace_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (task_id, label_id),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id) on delete cascade,
  foreign key (workspace_id, label_id) references public.labels (workspace_id, id) on delete cascade
);
create index task_labels_label_idx on public.task_labels (label_id);

-- "task_id is blocked by depends_on_task_id"
create table public.task_dependencies (
  task_id uuid not null,
  depends_on_task_id uuid not null,
  workspace_id uuid not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id) on delete cascade,
  foreign key (workspace_id, depends_on_task_id) references public.tasks (workspace_id, id) on delete cascade
);
create index task_dependencies_depends_idx on public.task_dependencies (depends_on_task_id);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  mentioned_user_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id) on delete cascade
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  file_name text not null check (char_length(file_name) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null check (char_length(mime_type) <= 255),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id) on delete cascade
);
create index task_attachments_task_idx on public.task_attachments (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Activity / audit log (append-only) and notifications
-- ---------------------------------------------------------------------------
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  event_type text not null check (event_type in (
    'task_created', 'task_edited', 'task_assigned', 'task_reassigned', 'task_unassigned',
    'status_changed', 'priority_changed', 'deadline_changed', 'progress_changed',
    'task_blocked', 'task_unblocked', 'task_completed', 'task_reopened',
    'task_archived', 'task_restored',
    'collaborator_added', 'collaborator_removed', 'label_added', 'label_removed',
    'dependency_added', 'dependency_removed',
    'comment_added', 'comment_edited', 'comment_deleted',
    'attachment_added', 'attachment_removed',
    'project_created', 'project_updated', 'project_member_added', 'project_member_removed',
    'member_joined', 'member_role_changed', 'member_department_changed',
    'member_deactivated', 'member_reactivated',
    'invitation_sent', 'invitation_revoked',
    'department_created', 'department_updated', 'department_deleted',
    'settings_updated'
  )),
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  -- clock_timestamp() keeps several events written in one transaction in order.
  created_at timestamptz not null default clock_timestamp()
);
create index activity_events_task_idx on public.activity_events (task_id, created_at);
create index activity_events_project_idx on public.activity_events (project_id, created_at);
create index activity_events_workspace_idx on public.activity_events (workspace_id, created_at desc);
create index activity_events_actor_idx on public.activity_events (actor_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  type public.notification_type not null,
  task_id uuid references public.tasks (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  emailed_at timestamptz,
  unique (recipient_id, dedupe_key)
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;
create index notifications_unemailed_idx on public.notifications (created_at) where emailed_at is null;
