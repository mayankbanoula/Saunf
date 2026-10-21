import "server-only";

import webpush from "web-push";

import { publicEnv } from "@/lib/env";
import { describeNotification } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationType } from "@/lib/tasks/constants";

const BATCH = 100;

type NotificationData = { key?: string; title?: string; excerpt?: string; note?: string; changes?: string[] };

export type PushRunResult = { configured: boolean; sent: number; failed: number; removed: number };

/** Web Push needs a VAPID key pair (free; generate with `npx web-push generate-vapid-keys`). */
export function pushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function vapidSubject() {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  return publicEnv.siteUrl.startsWith("https://") ? publicEnv.siteUrl : "mailto:notifications@example.com";
}

/**
 * Sends browser/phone push notifications for notifications that haven't been
 * pushed yet, to every device the recipient allowed. Each notification is
 * claimed (stamped `pushed_at`) first so concurrent runs never push it twice.
 * Pushes aren't retried: a missed one still shows in the app and by email.
 * Devices the push service reports as gone (404/410) are removed.
 */
export async function deliverPushNotifications(opts: { actorId?: string } = {}): Promise<PushRunResult> {
  if (!pushConfigured()) return { configured: false, sent: 0, failed: 0, removed: 0 };
  webpush.setVapidDetails(vapidSubject(), process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let query = admin
    .from("notifications")
    .select(
      "id, type, data, recipient_id, actor:profiles!notifications_actor_id_fkey(full_name, email), task:tasks(key, title)",
    )
    .is("pushed_at", null)
    .gte("created_at", since)
    .order("created_at")
    .limit(BATCH);
  if (opts.actorId) query = query.eq("actor_id", opts.actorId);
  const { data: pending, error } = await query;
  if (error) throw new Error(error.message);
  if (!pending?.length) return { configured: true, sent: 0, failed: 0, removed: 0 };

  const { data: claimed, error: claimError } = await admin
    .from("notifications")
    .update({ pushed_at: new Date().toISOString() })
    .in(
      "id",
      pending.map((n) => n.id),
    )
    .is("pushed_at", null)
    .select("id");
  if (claimError) throw new Error(claimError.message);
  const mine = new Set((claimed ?? []).map((c) => c.id));
  const todo = pending.filter((n) => mine.has(n.id));
  if (!todo.length) return { configured: true, sent: 0, failed: 0, removed: 0 };

  const { data: subs, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", [...new Set(todo.map((n) => n.recipient_id))]);
  if (subsError) throw new Error(subsError.message);
  if (!subs?.length) return { configured: true, sent: 0, failed: 0, removed: 0 };

  let sent = 0;
  let failed = 0;
  const gone = new Set<string>();
  await Promise.all(
    todo.flatMap((n) => {
      const data = n.data as NotificationData;
      const { text, detail } = describeNotification({
        type: n.type as NotificationType,
        data,
        actor: n.actor as { full_name: string; email: string } | null,
      });
      const task = n.task as { key: string; title: string } | null;
      const title = task?.title ?? data.title;
      const payload = JSON.stringify({
        title: text,
        body: [title, detail && detail !== title ? detail : null].filter(Boolean).join("\n"),
        url: task ? `/tasks/${task.key}` : "/notifications",
        tag: n.id,
      });
      return subs
        .filter((s) => s.user_id === n.recipient_id)
        .map(async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              payload,
              {
                TTL: 24 * 3600,
              },
            );
            sent++;
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) {
              gone.add(s.id);
            } else {
              failed++;
              console.error("[push] send failed", n.id, status ?? (e instanceof Error ? e.message : e));
            }
          }
        });
    }),
  );
  if (gone.size)
    await admin
      .from("push_subscriptions")
      .delete()
      .in("id", [...gone]);
  return { configured: true, sent, failed, removed: gone.size };
}

/** Sends a test push to every device one person enabled. Returns how many devices got it. */
export async function sendTestPush(userId: string): Promise<number> {
  if (!pushConfigured()) return 0;
  webpush.setVapidDetails(vapidSubject(), process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  const admin = createAdminClient();
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const payload = JSON.stringify({
    title: "Saunf notifications are on",
    body: "You'll get a notification like this when someone assigns you a task, comments or changes it.",
    url: "/notifications",
    tag: "saunf-test",
  });
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.id);
        else console.error("[push] test send failed", status ?? (e instanceof Error ? e.message : e));
      }
    }),
  );
  if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
  return sent;
}
