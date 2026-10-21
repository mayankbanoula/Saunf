import "server-only";

import { publicEnv } from "@/lib/env";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { describeNotification } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationType } from "@/lib/tasks/constants";

const BATCH = 100;

type NotificationData = { key?: string; title?: string; excerpt?: string; note?: string; changes?: string[] };

export type EmailRunResult = { configured: boolean; sent: number; skipped: number; failed: number };

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function renderEmail(text: string, title: string | undefined, detail: string | undefined, link: string) {
  const lines = [text, title && title !== detail ? `Task: ${title}` : null, detail ?? null, `Open: ${link}`];
  const plain = lines.filter(Boolean).join("\n\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p style="margin:0 0 12px;font-weight:600">${escapeHtml(text)}</p>
${title && title !== detail ? `<p style="margin:0 0 8px">${escapeHtml(title)}</p>` : ""}
${detail ? `<p style="margin:0 0 16px;color:#555;white-space:pre-line">${escapeHtml(detail)}</p>` : ""}
<p style="margin:0"><a href="${link}" style="display:inline-block;padding:8px 14px;background:#262f82;color:#fff;border-radius:6px;text-decoration:none">Open in Saunf</a></p>
<p style="margin:24px 0 0;font-size:12px;color:#888">You can turn off these emails in Settings.</p>
</div>`;
  return { plain, html };
}

/**
 * Sends emails for notifications that haven't been emailed yet. Recipients get
 * email only when the workspace enabled email notifications and their own
 * preference is on. Each notification is claimed (stamped `emailed_at`) before
 * sending so concurrent runs never send it twice; a failed send is un-stamped
 * so the next run retries it. Pass `actorId` to limit the run to notifications
 * caused by one person (used right after their action).
 */
export async function deliverNotificationEmails(opts: { actorId?: string } = {}): Promise<EmailRunResult> {
  if (!emailConfigured()) return { configured: false, sent: 0, skipped: 0, failed: 0 };

  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let query = admin
    .from("notifications")
    .select(
      "id, type, data, created_at, recipient:profiles!notifications_recipient_id_fkey(email, email_notifications), actor:profiles!notifications_actor_id_fkey(full_name, email), task:tasks(key, title), workspace_settings:workspaces(workspace_settings(email_notifications_enabled))",
    )
    .is("emailed_at", null)
    .gte("created_at", since)
    .order("created_at")
    .limit(BATCH);
  if (opts.actorId) query = query.eq("actor_id", opts.actorId);
  const { data: pending, error } = await query;
  if (error) throw new Error(error.message);
  if (!pending?.length) return { configured: true, sent: 0, skipped: 0, failed: 0 };

  const { data: claimed, error: claimError } = await admin
    .from("notifications")
    .update({ emailed_at: new Date().toISOString() })
    .in(
      "id",
      pending.map((n) => n.id),
    )
    .is("emailed_at", null)
    .select("id");
  if (claimError) throw new Error(claimError.message);
  const mine = new Set((claimed ?? []).map((c) => c.id));

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const n of pending) {
    if (!mine.has(n.id)) continue; // another run took it
    const wsEnabled = Boolean(
      (
        n.workspace_settings as unknown as {
          workspace_settings: { email_notifications_enabled: boolean } | null;
        } | null
      )?.workspace_settings?.email_notifications_enabled,
    );
    const recipient = n.recipient as { email: string; email_notifications: boolean } | null;
    if (!wsEnabled || !recipient?.email_notifications) {
      skipped++;
      continue;
    }
    const data = n.data as NotificationData;
    const { text, detail } = describeNotification({
      type: n.type as NotificationType,
      data,
      actor: n.actor as { full_name: string; email: string } | null,
    });
    const task = n.task as { key: string; title: string } | null;
    const title = task?.title ?? data.title;
    const link = task ? `${publicEnv.siteUrl}/tasks/${task.key}` : `${publicEnv.siteUrl}/notifications`;
    const { plain, html } = renderEmail(text, title, detail, link);
    try {
      await sendEmail(recipient.email, title ? `${text}: ${title}` : text, plain, html);
      sent++;
    } catch (e) {
      failed++;
      console.error("[email] send failed", n.id, e instanceof Error ? e.message : e);
      await admin.from("notifications").update({ emailed_at: null }).eq("id", n.id);
    }
  }
  return { configured: true, sent, skipped, failed };
}
