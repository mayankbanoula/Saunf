# Deploying Saunf

Saunf runs on Vercel, with Supabase as the database, auth and file store. These steps assume a new Supabase project and a new Vercel project.

## 1. Supabase project

1. Create a project and choose a region close to your users.
2. **Database → Extensions:** enable `pg_cron`. The migration schedules reminders with it. `pg_trgm` is created by the migrations.
3. Link and push the migrations from your machine:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   Check the result in **Database → Cron Jobs**: a job named `saunf-scheduled-jobs` runs every 15 minutes.
4. **Authentication → Sign In / Providers:**
   - Turn off **Allow new users to sign up**. Saunf is invite-only, and admin invites still work.
   - Keep the **Email** provider enabled. You can leave **Confirm email** on, because invites and admin-created accounts are pre-confirmed.
   - Set the minimum password length to at least 8.
5. **Authentication → URL Configuration:** set the Site URL to your production URL (for example `https://saunf.example.com`), and add it plus `https://saunf.example.com/**` to the redirect URLs.
6. **Authentication → Emails → SMTP:** configure your company's SMTP or a provider. Supabase's built-in sender is rate-limited and meant only for testing.
7. **Authentication → Email Templates:** replace the **Invite user** and **Reset password** templates with the contents of `supabase/templates/invite.html` and `supabase/templates/recovery.html`. They link to `/auth/confirm?token_hash=…`, which the app verifies on the server. Without them, invite and reset links won't work.
8. **Project Settings → API:** copy the project URL, the publishable key and the secret key for the next step.

## 2. Vercel project

1. Import the repository. The framework preset is detected as Next.js.
2. Environment variables (Production, and Preview if you use it):

   | Name                                   | Value                                                      |
   | -------------------------------------- | ---------------------------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`             | `https://<ref>.supabase.co`                                |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key                                            |
   | `SUPABASE_SECRET_KEY`                  | secret key. Do not expose it with a `NEXT_PUBLIC_` prefix. |
   | `NEXT_PUBLIC_SITE_URL`                 | your production URL                                        |
   | `CRON_SECRET`                          | a long random string, if you want notification emails      |
   | `RESEND_API_KEY`, `EMAIL_FROM`         | optional, for notification emails                          |

3. Deploy, then create the first admin from your machine using the production values:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… NEXT_PUBLIC_SITE_URL=… \
     npx tsx scripts/bootstrap.ts --workspace "Acme" --slug acme --email you@acme.com --name "You"
   ```
   Without `--password`, this sends an invitation email.

## 3. Scheduled work

| What                                                                | Where it runs                                                                               | Schedule                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| Due-soon and overdue notifications, auto-archive of completed tasks | `pg_cron` inside Postgres (`private.run_scheduled_jobs()`)                                  | every 15 minutes                |
| Notification emails                                                 | Vercel Cron → `GET /api/cron/email-notifications` with `Authorization: Bearer $CRON_SECRET` | `vercel.json`: every 15 minutes |

Vercel's Hobby plan only allows daily cron jobs. On Hobby, either change the schedule in `vercel.json` to a daily one, or call the endpoint from another scheduler with the bearer secret. In-app reminders don't depend on Vercel, because they run inside Postgres.

## 4. Backups and restore

- **Automatic backups.** Supabase Pro and above keep daily backups. Enable **Point-in-Time Recovery** if you need recovery to the minute.
- **Logical backups.** Schedule these, for example nightly from CI:
  ```bash
  npx supabase db dump --linked -f backup-schema.sql
  npx supabase db dump --linked --data-only -f backup-data.sql
  ```
  Storage objects aren't included in database dumps. Copy the `task-attachments` bucket with the S3-compatible API or `rclone` if you need file backups.
- **Restore.** Restore into a new project, preferably: `psql "$NEW_DB_URL" -f backup-schema.sql` and then `-f backup-data.sql`. Then point the app's environment variables at it.
- **Migrations are forward-only.** Test them on a branch or staging project before running `db push` to production.

## 5. Audit history and retention

`activity_events` and `task_assignments` are append-only. A trigger blocks UPDATE and DELETE for every role, the owner included. The one permitted update sets a deleted user's id to NULL, which pseudonymises history without changing it. To purge old audit data deliberately, for example under a retention policy, run it in a transaction as the database owner:

```sql
begin;
set local saunf.allow_audit_purge = 'on';
delete from public.activity_events where created_at < now() - interval '3 years';
commit;
```

Tasks are archived, never deleted. The workspace setting **Auto-archive completed tasks after N days** archives old completed work automatically.

## 6. Operational checklist

- [ ] Sign-ups disabled, SMTP configured, and email templates replaced
- [ ] `pg_cron` job visible and running (check **Database → Cron Jobs → History**)
- [ ] Secret key set only in server environment variables
- [ ] First admin created, and a second admin added so there is a backup admin
- [ ] Backups or PITR enabled
- [ ] `CRON_SECRET` set if notification emails are enabled
