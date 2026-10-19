# Saunf — Security model and permission matrix

This document is the specification the RLS policies, triggers and server actions
implement. If code and this document disagree, that is a bug.

## 1. Principles

- **Postgres decides.** All application reads/writes run with the signed-in user's
  JWT. Row Level Security is enabled on every table in `public` and on
  `storage.objects` for the attachments bucket. The UI only hides controls for
  convenience.
- **Identity comes from the JWT.** `auth.uid()` is the actor. Triggers overwrite
  `creator_id`, `author_id`, `uploaded_by`, `changed_by`, `actor_id`, `created_at`,
  etc. with server values, so a forged body field has no effect.
- **Workspace comes from membership.** RPCs resolve the caller's workspace from
  `workspace_members`; rows that reference a workspace are cross-checked with
  composite foreign keys `(workspace_id, id)` so a task can't point at another
  workspace's project, label, department or member.
- **Inactive = no access.** Every policy requires an _active_ membership
  (`private.member_role()` returns NULL for inactive members). Deactivation also
  bans the auth user so the session can't be refreshed, and the app signs out
  any request whose member row is inactive.
- **Privileged helpers live in a non-exposed schema.** Permission predicates are
  `SECURITY DEFINER` functions in schema `private` (not exposed through the Data
  API), with `search_path = ''`. They read base tables directly, which avoids RLS
  recursion. They take the user id explicitly so triggers can also evaluate
  permissions for notification recipients.
- **Service role is server-only.** `SUPABASE_SECRET_KEY` (service role) is read
  only in `src/lib/supabase/admin.ts` (`import 'server-only'`) and used only for
  Supabase Auth admin operations: invite user, create user, ban/unban user. Every
  such call is preceded by an admin check made with the caller's own JWT.
- **Audit is append-only.** `activity_events` and `task_assignments` have no
  INSERT/UPDATE/DELETE grants for `anon`/`authenticated`; rows are written by
  `SECURITY DEFINER` triggers. A trigger rejects UPDATE/DELETE for every role
  (including the owner) unless the retention job sets `saunf.allow_audit_purge`.
- **No secrets in logs.** Audit rows store field values (title, status, ids,
  file names) — never passwords, tokens or file contents. Description changes are
  logged as "changed", not as full text.

## 2. Definitions

- **Member**: a user with an _active_ `workspace_members` row.
- **Participant** of a task: its creator, current assignee, or a collaborator.
- **Reportees** of _M_: members whose `workspace_members.reports_to` is _M_, and
  their reportees, at any depth. Only admins set `reports_to`, and only to an
  active manager or admin. Self-reporting and loops are rejected; when someone
  stops being a manager or admin (or is deactivated), their direct reportees are
  left without a manager.
- **People scope** of a user: admins, everyone; managers, themselves plus their
  reportees; employees, only themselves.
- **Manager scope** of manager _M_: departments where `departments.manager_id = M`,
  plus _M_'s own department. A task is in scope if its `department_id`, its
  assignee's department or its creator's department is in that set, or if its
  assignee or creator is one of _M_'s reportees.
- **Project manager** of a project: its owner or a project member with role `lead`.
- **Task editor**: admin; the task's creator; a manager whose scope contains the
  task; a project manager of the task's project.
- **Task worker**: a task editor, the assignee, or a collaborator.

## 3. Workspace settings that change permissions

| Setting                      | Values                                     | Effect                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `employees_can_create_tasks` | `true` (default) / `false`                 | Whether employees may create tasks.                                                                                                                                                                                                          |
| `assignment_policy`          | `anyone` (default) / `department` / `self` | Whom an **employee** may assign (on create or reassign): any member / members of their own department and themselves / only themselves. Managers and admins can assign any member.                                                           |
| `task_visibility`            | `all` (default) / `participants`           | `all`: members can see every task except tasks in private projects they don't belong to. `participants`: employees see only tasks they participate in or that belong to projects they are members of; managers additionally see their scope. |

Regardless of settings: admins see everything; participants always see their own
tasks; tasks in a **private project** are visible only to admins, participants and
project members/owner.

## 4. Permission matrix

| Capability                                                                                                                     |                  Admin                   |                   Manager                   |              Employee              |
| ------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------: | :-----------------------------------------: | :--------------------------------: |
| Sign in, view own profile, edit own name/title/prefs                                                                           |                    ✅                    |                     ✅                      |                 ✅                 |
| View employee directory (name, email, title, role, department)                                                                 |                    ✅                    |                     ✅                      |                 ✅                 |
| Invite / create employees                                                                                                      |                    ✅                    |                     ❌                      |                 ❌                 |
| Change roles, departments; activate / deactivate                                                                               |   ✅ (not self; never the last admin)    |                     ❌                      |                 ❌                 |
| Manage departments                                                                                                             |                    ✅                    |                     ❌                      |                 ❌                 |
| Edit workspace settings                                                                                                        |                    ✅                    |                     ❌                      |                 ❌                 |
| View workspace-level audit log (members, settings)                                                                             |                    ✅                    |                     ❌                      |                 ❌                 |
| Create project                                                                                                                 |                    ✅                    |                     ✅                      |                 ❌                 |
| Edit project / manage its members                                                                                              |                    ✅                    |               project manager               |          project manager           |
| View project                                                                                                                   |                    ✅                    |     public projects; private if member      | public projects; private if member |
| View task                                                                                                                      |                   all                    |            §3 visibility + scope            |           §3 visibility            |
| Create task                                                                                                                    |                    ✅                    |                     ✅                      |  if `employees_can_create_tasks`   |
| Assign on create / reassign to member X                                                                                        |                any member                |                 any member                  |      per `assignment_policy`       |
| Reassign an existing task                                                                                                      |                    ✅                    |       task editor or current assignee       |  task editor or current assignee   |
| Edit details (title, description, priority, dates, project, department, parent, estimate, labels, collaborators, dependencies) |                    ✅                    |                 task editor                 |  task editor (usually: own tasks)  |
| Change status, progress, blocked flag; complete / reopen                                                                       |                    ✅                    |                 task worker                 |            task worker             |
| Archive / restore task                                                                                                         |                    ✅                    |                 task editor                 |            task editor             |
| Edit an archived task (other than restore)                                                                                     |                    ❌                    |                     ❌                      |                 ❌                 |
| Delete a task permanently                                                                                                      |    ❌ (not exposed; archive instead)     |                     ❌                      |                 ❌                 |
| Comment on a task                                                                                                              |         can view & not archived          |                    same                     |                same                |
| Edit a comment                                                                                                                 |                   own                    |                     own                     |                own                 |
| Delete (soft) a comment                                                                                                        |                   any                    |                     own                     |                own                 |
| Upload attachment                                                                                                              |         can view & not archived          |                    same                     |                same                |
| Download attachment                                                                                                            |              can view task               |                    same                     |                same                |
| Delete attachment                                                                                                              |                    ✅                    |           uploader or task editor           |      uploader or task editor       |
| Create labels                                                                                                                  |                    ✅                    |                     ✅                      |                 ✅                 |
| Rename / delete labels                                                                                                         |                    ✅                    |                     ✅                      |                 ❌                 |
| View activity events on a task / project                                                                                       |                   all                    | own + reportees'; all on tasks they work on |   own; all on tasks they work on   |
| Dashboard, reports, calendar and team workload numbers                                                                         |                 everyone                 |              own + reportees'               |                own                 |
| Personal to-do list (`todos`, `todo_completions`)                                                                              |       read anyone's; edit own only       |                  own only                   |              own only              |
| Read / send private messages (`conversations`, `messages`)                                                                     | own conversations only (no admin access) |                  own only                   |              own only              |
| Group chats (`chat_groups`, `chat_group_members`, `group_messages`)                                                            | groups they're in only (no admin access) |           groups they're in only            |       groups they're in only       |
| Set who a member reports to                                                                                                    |                    ✅                    |                     ❌                      |                 ❌                 |
| View assignment history                                                                                                        |             if can view task             |                    same                     |                same                |
| Read notifications                                                                                                             |                 own only                 |                  own only                   |              own only              |
| Mark notification read                                                                                                         |     own only (`read_at` column only)     |                    same                     |                same                |
| Edit / delete activity history                                                                                                 |                    ❌                    |                     ❌                      |                 ❌                 |

Notes:

- "Tasks they work on" means _task worker_ (§2). Activity on a task is visible
  only if the task itself is visible. Opening a task you can see but don't work
  on shows only your own and your reportees' actions on it.
- Reporting numbers (`dashboard_summary`, `task_throughput`, `project_progress`)
  and `tasks_in_view` / `activity_in_view` cover tasks where someone in the
  caller's people scope is the assignee, creator or a collaborator.
  `workload_by_member` counts by assignee.
  Their optional `p_member` argument narrows to one person and never widens the
  scope. The task list and board still follow §3 task visibility; set
  `task_visibility = participants` to hide other people's tasks there too.
- To-do lists are private. Only the owner can add, change, tick or delete items
  (`set_todo_done` ticks today's date in the workspace timezone for repeating
  items). Admins can read every list and its daily history but cannot change it.
  Managers have no access to their reportees' lists.
- Messages are private to the two people in a conversation. There is no admin
  exception, and messages are never copied into the activity log or audit trail.
  Messages can't be edited by anyone. As with all data, anyone with direct
  database access (the Supabase project owner, or the service-role key) can still
  read the tables; the app never uses the service role for messages.
- Group chats: only current members can read or post; admins have no access to
  groups they aren't in. Only the group's creator can rename it or add and remove
  people; anyone can leave. New members can read earlier messages; people who
  leave or are removed lose access. Group changes go through `SECURITY DEFINER`
  RPCs that check these rules; group messages are never logged.
- Admins cannot read other users' notifications. Notifications are personal; the
  audit log already gives admins the information.
- Comment and attachment rights inherit task visibility.
- An assignee who hands a task to someone else loses access to it if they are no
  longer a participant and visibility is `participants`.

## 5. Field-level rules on `tasks` (trigger `tasks_before_update`)

- Immutable: `id`, `workspace_id`, `number`, `key`, `creator_id`, `created_at`.
- Server-derived: `updated_at`, `updated_by`, `assigned_at`, `assigned_by`,
  `completed_at`, `completed_by`, `archived_at` (set to `now()`), `archived_by`.
- Detail fields require _task editor_; work fields (`status`, `progress`,
  `is_blocked`, `blocker_description`) require _task worker_; `assignee_id`
  requires editor-or-current-assignee **and** the assignment policy for the new
  assignee; `archived_at` requires editor.
- Archived tasks reject any change except restoring.
- Status → `done` sets `progress = 100`, `completed_at = now()`, `completed_by`.
  Leaving `done` clears `completed_at`/`completed_by`; if progress was 100 and the
  caller didn't set progress, it becomes 0 (To do) or 90 (In progress / In review).

## 6. Storage

- Bucket `task-attachments` is **private** (`public = false`), 25 MB per file,
  restricted MIME types (images, PDF, text/CSV, Office documents, ZIP).
- Object path: `<workspace_id>/<task_id>/<random>-<sanitised file name>`.
- `storage.objects` policies: upload/download require that the caller can view
  the task in the path (and, for upload, that it isn't archived); delete requires
  uploader, task editor or admin.
- Downloads use short-lived signed URLs (60 s) created after an RLS-checked read
  of the attachment row.

## 7. Authentication

- Accounts come from (a) an admin invitation, (b) an admin-created account, or
  (c) self sign-up at `/signup`. Self sign-up is **on by default**, open to any address
  with no approval. An admin can turn it off, restrict it to email domains
  (`signup_allowed_domains`) or require approval (`signup_requires_approval`).
- The `on_auth_user_created` trigger decides membership. A pending invitation wins and
  keeps its role and department. On an empty installation the first account creates the
  workspace and becomes its admin. Otherwise the user joins the oldest workspace open to
  their email domain, always as **employee** (sign-up metadata can't set a role). If
  approval is required they start inactive and get no data until an admin approves
  them. If no workspace is open to them, the trigger rejects the account.
- With Supabase "Confirm email" off, a domain restriction doesn't prove someone owns
  the address. Use email confirmation (needs SMTP) or admin approval.
- Session cookies are managed by `@supabase/ssr`; `proxy.ts` refreshes them and
  redirects anonymous users from app routes to `/login`. Server code re-validates
  with `supabase.auth.getClaims()` (verifies the JWT) in the data-access layer —
  the proxy is not relied on for authorisation.
- Invite and recovery emails link to `/auth/confirm?token_hash=…&type=…`, which
  verifies the one-time token server-side and sets the session cookie.
- Minimum password length is 8.

## 8. How this is tested

`tests/integration/*.test.ts` run against the local Supabase stack with real JWTs
for an admin, a manager, two employees, a deactivated employee and a member of a
second workspace. They cover allowed **and** denied paths for every row in the
matrix above, plus workspace isolation and append-only audit tables.
