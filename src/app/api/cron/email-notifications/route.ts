import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { deliverNotificationEmails } from "@/lib/email/notifications";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Sends pending notification emails. Call on a schedule (Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`). Most emails already go out right after
 * the action that caused them; this run catches the rest (due-date reminders
 * from the database scheduler and any send that failed).
 */
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await deliverNotificationEmails());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
