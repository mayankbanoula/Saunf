"use server";

import { z } from "zod";

import { dbErrorMessage, fail, ok, runAction, validationFailure, type ActionResult } from "@/lib/actions";
import { viewerForAction } from "@/lib/auth/session";
import { pushConfigured, sendTestPush } from "@/lib/push/notifications";
import { createClient } from "@/lib/supabase/server";

const subscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
  userAgent: z.string().max(400).optional(),
});

/** Saves this browser's push subscription for the signed-in person. */
export async function savePushSubscription(input: z.input<typeof subscriptionSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    const parsed = subscriptionSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_push_subscription", {
      p_endpoint: parsed.data.endpoint,
      p_p256dh: parsed.data.keys.p256dh,
      p_auth: parsed.data.keys.auth,
      p_user_agent: parsed.data.userAgent,
    });
    if (error) return fail(dbErrorMessage(error));
    return ok(null);
  });
}

export async function deletePushSubscription(endpoint: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    const parsed = z.string().max(2000).safeParse(endpoint);
    if (!parsed.success) return fail("Invalid subscription.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_push_subscription", { p_endpoint: parsed.data });
    if (error) return fail(dbErrorMessage(error));
    return ok(null);
  });
}

export async function sendTestPushNotification(): Promise<ActionResult<number>> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    if (!pushConfigured()) return fail("Push notifications aren't set up on this server.");
    const { sent, errors } = await sendTestPush(viewer.id);
    if (!sent) {
      return fail(
        errors.length
          ? `The push service refused it: ${errors[0]}`
          : "No device is registered. Turn notifications off and on again on this device.",
      );
    }
    return ok(sent);
  });
}
