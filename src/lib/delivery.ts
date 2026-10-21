import "server-only";

import { after } from "next/server";

import { deliverNotificationEmails } from "@/lib/email/notifications";
import { emailConfigured } from "@/lib/email/send";
import { deliverPushNotifications, pushConfigured } from "@/lib/push/notifications";

/**
 * Emails and pushes the notifications an action just created, after the
 * response is sent so the action stays fast. The scheduled cron picks up
 * anything missed.
 */
export function deliverNotificationsAfter(actorId: string) {
  if (!process.env.SUPABASE_SECRET_KEY || !(emailConfigured() || pushConfigured())) return;
  after(async () => {
    const results = await Promise.allSettled([
      deliverNotificationEmails({ actorId }),
      deliverPushNotifications({ actorId }),
    ]);
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[notify] immediate delivery failed", r.reason instanceof Error ? r.reason.message : r.reason);
      }
    }
  });
}
