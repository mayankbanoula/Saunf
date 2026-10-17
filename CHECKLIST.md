# Saunf — implementation checklist

_Last updated: 17 Oct 2026_

## Completed

**Phase 1 — Architecture**

- [x] Environment inspected; stack chosen (Next.js 16.4.2, React 19.3, Tailwind 4, Supabase, Postgres 17)
- [x] Architecture, folder structure and schema documented (`docs/ARCHITECTURE.md`)
- [x] Security model and permission matrix written before the policies (`docs/SECURITY.md`)

**Phase 2 — Foundation**

- [x] Next.js App Router, strict TypeScript, Tailwind CSS 4 design tokens, shadcn-style Radix components
- [x] Supabase migrations: schema, RLS on every table, triggers, RPCs, private storage bucket, `pg_cron`
- [x] Supabase Auth: login, logout, forgot/reset password, session refresh in `proxy.ts`
- [x] Employee self sign-up (`/signup`), off by default; admins control allowed email domains and optional approval. Invitations and admin-created accounts also supported.
- [x] Data-access layer (`getClaims` verification, active membership check); inactive users are redirected and lose RLS access
- [x] App shell: collapsible sidebar, mobile drawer, global search (⌘K), quick create, notifications, user menu

**Phase 3 — Core task management**

- [x] Create, edit, assign, reassign (with note), status, priority, deadlines, progress, blocked flag, labels, collaborators, subtasks, dependencies
- [x] Concurrency-safe task keys (`SAU-00001`) from a per-workspace counter row lock
- [x] Field-level permission guard and server-derived timestamps (created / assigned / completed / archived / updated)
- [x] Complete / reopen semantics; archive / restore; archived tasks locked
- [x] Task detail page with a full activity timeline and assignment history

**Phase 4 — Collaboration**

- [x] Comments: edit (author), soft delete (author or admin), @mentions validated in the database
- [x] Attachments: private bucket, storage RLS, type and size limits, signed download URLs
- [x] Notifications: assignment, reassignment, collaborator added, comment, mention, review requested, completed, reopened, due soon, overdue
- [x] List view (sorting, pagination, bulk actions), Kanban (drag and drop, optimistic with rollback), Calendar (month/week), My Tasks, Created by Me, All Tasks
- [x] Search and filters (URL-persisted), global search

**Phase 5 — Reporting and administration**

- [x] Dashboard from live data, with date range, clickable metrics, charts, deadlines, activity, project progress and workload
- [x] Projects (public/private, members, leads, progress, activity), departments, team directory, person pages
- [x] Reports: throughput, status/priority breakdowns, workload table, project table
- [x] Admin panel: members (role, department, activate/deactivate with sign-in ban), invitations (send, resend, revoke), departments, projects, workspace settings, archive, audit log
- [x] Personal settings: profile, password change (verifies current password), email preference

**Phase 6 — Hardening**

- [x] 46 unit tests, 58 RLS/workflow integration tests, 20 Playwright end-to-end tests (all passing)
- [x] Lint (0 problems), typecheck, Prettier, production build
- [x] Mobile layout verified at 390 px: no horizontal overflow on the main pages (tested)
- [x] README, deployment, backup and retention guide, CI workflow

## Commands verified in this environment

| Command                                                      | Result                                    |
| ------------------------------------------------------------ | ----------------------------------------- |
| `npm ci` (from lockfile, clean directory)                    | ✅                                        |
| `npm run lint`                                               | ✅ 0 problems                             |
| `npm run typecheck`                                          | ✅                                        |
| `npm run format:check`                                       | ✅                                        |
| `npm run test:unit`                                          | ✅ 46 passed                              |
| `npm run test:integration`                                   | ✅ 58 passed (local Supabase in Docker)   |
| `npm run build`                                              | ✅                                        |
| `npm run test:e2e`                                           | ✅ 20 passed (production build, Chromium) |
| `npm run db:reset`, `npm run bootstrap`, `npm run seed:demo` | ✅                                        |
| `npm audit --omit=dev`                                       | ✅ 0 vulnerabilities                      |

The CI workflow (`.github/workflows/ci.yml`) mirrors these commands but has not run on GitHub Actions yet.

## Outstanding / not verified

- **Hosted deployment.** The app hasn't been deployed to Vercel or a hosted Supabase project from here, because no credentials were available. Follow `docs/DEPLOYMENT.md`.
- **Notification email delivery.** The `/api/cron/email-notifications` endpoint is implemented. Its auth, eligibility query, retry-on-failure and the "not configured" path are tested, but real delivery through Resend was not tested because there was no API key or outbound access to the provider.
- **Auth emails on a hosted project.** Invite, password-reset and sign-up flows were verified end to end against the local stack (Mailpit), with both custom (token_hash) and Supabase-default (#fragment) link formats. On a hosted project, delivery depends on your SMTP settings and the templates in `supabase/templates/` being pasted into the dashboard.

## Known limitations and product decisions

- **One workspace per user.** The schema supports several workspaces, but the UI resolves the user's first active membership.
- **Admins can't read other people's notifications.** Notifications are personal; the audit log covers oversight.
- **Kanban ordering is automatic** (priority, then due date). Manual ordering within a column isn't stored.
- **Comments are plain text** with @mentions. There's no rich-text or Markdown rendering.
- **The notification badge polls every 60 seconds.** Supabase Realtime is disabled in `supabase/config.toml` to keep the stack small. Task data refreshes after every action.
- **RLS cost.** Task visibility is decided per row by SQL functions. This is fine for thousands to tens of thousands of tasks; very large workspaces may need a denormalised access table.
- **Board and calendar caps.** The board shows at most 300 tasks and the calendar at most 600 per range, with a notice when truncated.
- **npm config.** `.npmrc` sets `legacy-peer-deps=true` to work around an npm 10 resolver crash on Vitest's optional peers.
- **Dev-only audit advisory.** `npm audit` reports `braces` (via `eslint-config-next` → `fast-glob`). npm's suggested "fix" is downgrading to Next 14 tooling, so it was left in place. It doesn't ship to production.
