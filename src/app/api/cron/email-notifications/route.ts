import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/env";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { describeNotification } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationType } from "@/lib/tasks/constants";

const BATCH = 100;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Sends pending notification emails. Call on a schedule (Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`). Recipients get email only when the
 * workspace enabled email notifications and their own preference is on; every
 * processed notification is stamped `emailed_at` so it's never sent twice.
 */
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!emailConfigured()) return NextResponse.json({ configured: false, sent: 0 });

  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: pending, error } = await admin
    .from("notifications")
    .select(
      "id, type, data, created_at, recipient:profiles!notifications_recipient_id_fkey(email, email_notifications), actor:profiles!notifications_actor_id_fkey(full_name, email), task:tasks(key), workspace_settings:workspaces(workspace_settings(email_notifications_enabled))",
    )
    .is("emailed_at", null)
    .gte("created_at", since)
    .order("created_at")
    .limit(BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const n of pending ?? []) {
    const wsEnabled = Boolean(
      (n.workspace_settings as unknown as { workspace_settings: { email_notifications_enabled: boolean } | null } | null)
        ?.workspace_settings?.email_notifications_enabled,
    );
    const recipient = n.recipient as { email: string; email_notifications: boolean } | null;
    if (!wsEnabled || !recipient?.email_notifications) {
      skipped++;
    } else {
      const { text, detail } = describeNotification({
        type: n.type as NotificationType,
        data: n.data as { key?: string; title?: string; excerpt?: string; note?: string },
        actor: n.actor as { full_name: string; email: string } | null,
      });
      const key = (n.task as { key: string } | null)?.key;
      const link = key ? `${publicEnv.siteUrl}/tasks/${key}` : `${publicEnv.siteUrl}/notifications`;
      try {
        await sendEmail(
          recipient.email,
          `Saunf: ${text}`,
          `${text}${detail ? `\n\n${detail}` : ""}\n\nOpen: ${link}`,
          `<p>${escapeHtml(text)}</p>${detail ? `<p style="color:#555">${escapeHtml(detail)}</p>` : ""}<p><a href="${link}">Open in Saunf</a></p>`,
        );
        sent++;
      } catch (e) {
        failures.push(n.id);
        console.error("[cron:email] send failed", n.id, e instanceof Error ? e.message : e);
        continue; // leave emailed_at null so it is retried next run
      }
    }
    await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id);
  }
  return NextResponse.json({ configured: true, sent, skipped, failed: failures.length });
}
