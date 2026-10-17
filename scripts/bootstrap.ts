/**
 * Create the Saunf workspace and its first admin account.
 *
 *   npm run bootstrap -- --workspace "Acme Ltd" --slug acme --prefix SAU \
 *     --email admin@acme.com --name "Ananya Rao" [--password '...']
 *
 * Without --password, an invitation email is sent instead (requires working SMTP).
 * Uses SUPABASE_SECRET_KEY, so run it from a trusted machine only.
 */
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const { values } = parseArgs({
  options: {
    workspace: { type: "string" },
    slug: { type: "string" },
    prefix: { type: "string", default: "SAU" },
    email: { type: "string" },
    name: { type: "string", default: "" },
    password: { type: "string" },
    timezone: { type: "string", default: "UTC" },
  },
});

function die(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) die("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (see .env.example).");
  if (!values.workspace || !values.slug || !values.email) die("--workspace, --slug and --email are required.");

  const email = values.email.trim().toLowerCase();
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: existing } = await admin.from("workspaces").select("id").eq("slug", values.slug).maybeSingle();
  let workspaceId = existing?.id as string | undefined;
  if (!workspaceId) {
    const { data: ws, error } = await admin
      .from("workspaces")
      .insert({ name: values.workspace, slug: values.slug, task_prefix: values.prefix!.toUpperCase() })
      .select("id")
      .single();
    if (error) die(`Could not create workspace: ${error.message}`);
    workspaceId = ws.id;
    const { error: settingsError } = await admin
      .from("workspace_settings")
      .insert({ workspace_id: workspaceId, timezone: values.timezone });
    if (settingsError) die(`Could not create workspace settings: ${settingsError.message}`);
    console.log(`✔ Created workspace "${values.workspace}" (${workspaceId})`);
  } else {
    console.log(`• Workspace "${values.slug}" already exists (${workspaceId})`);
  }

  // The on_auth_user_created trigger turns this pending invitation into an admin membership.
  const { error: invError } = await admin
    .from("invitations")
    .insert({ workspace_id: workspaceId, email, role: "admin", full_name: values.name ?? "" });
  if (invError && invError.code !== "23505") die(`Could not create invitation: ${invError.message}`);

  if (values.password) {
    const { error } = await admin.auth.admin.createUser({
      email,
      password: values.password,
      email_confirm: true,
      user_metadata: { full_name: values.name },
    });
    if (error) die(`Could not create admin user: ${error.message}`);
    await admin.from("invitations").update({ status: "accepted" }).eq("email", email).eq("status", "pending");
    console.log(
      `✔ Admin account created for ${email}. Sign in at ${process.env.NEXT_PUBLIC_SITE_URL ?? "your app URL"}/login`,
    );
  } else {
    const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${site}/auth/confirm?next=/set-password`,
      data: { full_name: values.name },
    });
    if (error) die(`Could not send invitation: ${error.message}`);
    console.log(`✔ Invitation sent to ${email}.`);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
