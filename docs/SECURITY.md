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
- **Manager scope** of manager _M_: departments where `departments.manager_id = M`,
  plus _M_'s own department. A task is in scope if its `department_id`, its
  assignee's department or its creator's department is in that set.
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

| Capability                                                                                                                     |                Admin                |              Manager               |              Employee              |
| ------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------: | :--------------------------------: | :--------------------------------: |
| Sign in, view own profile, edit own name/title/prefs                                                                           |                 ✅                  |                 ✅                 |                 ✅                 |
| View employee directory (name, email, title, role, department)                                                                 |                 ✅                  |                 ✅                 |                 ✅                 |
| Invite / create employees                                                                                                      |                 ✅                  |                 ❌                 |                 ❌                 |
| Change roles, departments; activate / deactivate                                                                               | ✅ (not self; never the last admin) |                 ❌                 |                 ❌                 |
| Manage departments                                                                                                             |                 ✅                  |                 ❌                 |                 ❌                 |
| Edit workspace settings                                                                                                        |                 ✅                  |                 ❌                 |                 ❌                 |
| View workspace-level audit log (members, settings)                                                                             |                 ✅                  |                 ❌                 |                 ❌                 |
| Create project                                                                                                                 |                 ✅                  |                 ✅                 |                 ❌                 |
| Edit project / manage its members                                                                                              |                 ✅                  |          project manager           |          project manager           |
| View project                                                                                                                   |                 ✅                  | public projects; private if member | public projects; private if member |
| View task                                                                                                                      |                 all                 |       §3 visibility + scope        |           §3 visibility            |
| Create task                                                                                                                    |                 ✅                  |                 ✅                 |  if `employees_can_create_tasks`   |
| Assign on create / reassign to member X                                                                                        |             any member              |             any member             |      per `assignment_policy`       |
| Reassign an existing task                                                                                                      |                 ✅                  |  task editor or current assignee   |  task editor or current assignee   |
| Edit details (title, description, priority, dates, project, department, parent, estimate, labels, collaborators, dependencies) |                 ✅                  |            task editor             |  task editor (usually: own tasks)  |
| Change status, progress, blocked flag; complete / reopen                                                                       |                 ✅                  |            task worker             |            task worker             |
| Archive / restore task                                                                                                         |                 ✅                  |            task editor             |            task editor             |
| Edit an archived task (other than restore)                                                                                     |                 ❌                  |                 ❌                 |                 ❌                 |
| Delete a task permanently                                                                                                      |  ❌ (not exposed; archive instead)  |                 ❌                 |                 ❌                 |
| Comment on a task                                                                                                              |       can view & not archived       |                same                |                same                |
| Edit a comment                                                                                                                 |                 own                 |                own                 |                own                 |
| Delete (soft) a comment                                                                                                        |                 any                 |                own                 |                own                 |
| Upload attachment                                                                                                              |       can view & not archived       |                same                |                same                |
| Download attachment                                                                                                            |            can view task            |                same                |                same                |
| Delete attachment                                                                                                              |                 ✅                  |      uploader or task editor       |      uploader or task editor       |
| Create labels                                                                                                                  |                 ✅                  |                 ✅                 |                 ✅                 |
| Rename / delete labels                                                                                                         |                 ✅                  |                 ✅                 |                 ❌                 |
| View task activity / assignment history                                                                                        |          if can view task           |                same                |                same                |
| Read notifications                                                                                                             |              own only               |              own only              |              own only              |
| Mark notification read                                                                                                         |  own only (`read_at` column only)   |                same                |                same                |
| Edit / delete activity history                                                                                                 |                 ❌                  |                 ❌                 |                 ❌                 |

Notes:

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

- Public sign-up is disabled (`auth.enable_signup = false`). Accounts are created
  only by an admin invitation or admin-created account.
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
