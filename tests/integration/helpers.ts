/**
 * Integration-test harness: runs against the local Supabase stack (`npm run db:start`).
 * Each test file builds isolated workspaces with real users and signs in as them, so
 * every assertion goes through real JWTs, PostgREST, RLS, triggers and Storage.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import pg from "pg";

import type { Database } from "@/lib/database.types";

config({ path: ".env.local", quiet: true });

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
export const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const PASSWORD = "Test-pass-123!";

if (!ANON || !SECRET) {
  throw new Error(
    "Integration tests need NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (start Supabase and fill .env.local).",
  );
}
if (!/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  throw new Error(`Refusing to run integration tests against a non-local Supabase (${SUPABASE_URL}).`);
}

export type Client = SupabaseClient<Database>;

export const service: Client = createClient<Database>(SUPABASE_URL, SECRET, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Run SQL as the database owner (for scheduler functions and tamper tests). */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    await client.end();
  }
}

export type TestUser = { id: string; email: string; client: Client };

const created = { workspaces: [] as string[], users: [] as string[] };

export async function createWorkspace(
  overrides: Partial<Database["public"]["Tables"]["workspace_settings"]["Insert"]> = {},
) {
  const slug = `t-${randomUUID().slice(0, 12)}`;
  const { data, error } = await service
    .from("workspaces")
    .insert({ name: `Test ${slug}`, slug, task_prefix: "SAU" })
    .select("id")
    .single();
  if (error) throw error;
  // Test workspaces are closed to self sign-up unless a test opts in, so sign-ups land predictably.
  const { error: sErr } = await service
    .from("workspace_settings")
    .insert({ workspace_id: data.id, self_signup_enabled: false, ...overrides });
  if (sErr) throw sErr;
  created.workspaces.push(data.id);
  return data.id;
}

export async function createDepartment(workspaceId: string, name: string, managerId?: string) {
  const { data, error } = await service
    .from("departments")
    .insert({ workspace_id: workspaceId, name, manager_id: managerId ?? null })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Create a member via the real invitation → auth user → trigger path, then sign in. */
export async function createUser(
  workspaceId: string,
  role: "admin" | "manager" | "employee",
  opts: { departmentId?: string; name?: string } = {},
): Promise<TestUser> {
  const email = `${role}-${randomUUID().slice(0, 8)}@test.saunf.local`;
  const { error: invErr } = await service.from("invitations").insert({
    workspace_id: workspaceId,
    email,
    role,
    department_id: opts.departmentId ?? null,
    full_name: opts.name ?? role,
  });
  if (invErr) throw invErr;
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  created.users.push(data.user.id);
  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

/** Register an auth user created outside the helpers (e.g. by self sign-up) for cleanup. */
export function trackUser(id: string) {
  created.users.push(id);
}

export async function cleanup() {
  // Audit tables are append-only; the purge flag is the sanctioned way to remove test data.
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await db.query("begin");
    await db.query("set local saunf.allow_audit_purge = 'on'");
    await db.query("delete from public.workspaces where id = any($1::uuid[])", [created.workspaces]);
    await db.query("commit");
  } finally {
    await db.end();
  }
  for (const id of created.users) await service.auth.admin.deleteUser(id);
  created.workspaces.length = 0;
  created.users.length = 0;
}

/** Create a task as `user` through the same RPC the app uses. */
export async function createTask(
  user: TestUser,
  task: Record<string, unknown>,
  extra: { labels?: string[]; collaborators?: string[]; note?: string } = {},
) {
  const { data, error } = await user.client
    .rpc("create_task", {
      p_task: task as never,
      p_label_ids: extra.labels ?? [],
      p_collaborator_ids: extra.collaborators ?? [],
      p_note: extra.note,
    })
    .single();
  if (error) throw error;
  return data;
}

export async function updateTask(user: TestUser, taskId: string, patch: Record<string, unknown>, note?: string) {
  return user.client.rpc("update_task", { p_task_id: taskId, p_patch: patch as never, p_note: note });
}

/** A standard world: one workspace with an admin, a manager of dept A, two employees and an outsider in another workspace. */
export async function buildWorld(settings: Partial<Database["public"]["Tables"]["workspace_settings"]["Insert"]> = {}) {
  const ws = await createWorkspace(settings);
  const deptA = await createDepartment(ws, "Engineering");
  const deptB = await createDepartment(ws, "Finance");
  const admin = await createUser(ws, "admin", { name: "Ada Admin" });
  const manager = await createUser(ws, "manager", { departmentId: deptA, name: "Manu Manager" });
  await service.from("departments").update({ manager_id: manager.id }).eq("id", deptA);
  const emp1 = await createUser(ws, "employee", { departmentId: deptA, name: "Esha Employee" });
  const emp2 = await createUser(ws, "employee", { departmentId: deptB, name: "Farhan Finance" });
  const otherWs = await createWorkspace();
  const outsider = await createUser(otherWs, "admin", { name: "Olga Outsider" });
  return { ws, deptA, deptB, admin, manager, emp1, emp2, otherWs, outsider };
}
