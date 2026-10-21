import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets, image optimisation, the service worker and
    // web app manifest, and the cron endpoint (which authenticates with CRON_SECRET
    // instead of a session).
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
