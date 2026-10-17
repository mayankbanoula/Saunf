import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { anonClient, cleanup, createUser, createWorkspace, DB_URL, PASSWORD, service, sql, trackUser } from "./helpers";

afterAll(cleanup);

const domain = () => `signup-${randomUUID().slice(0, 8)}.test`;

async function signUp(email: string, data: Record<string, unknown> = {}) {
  const client = anonClient();
  const res = await client.auth.signUp({ email, password: PASSWORD, options: { data } });
  if (res.data.user) trackUser(res.data.user.id);
  return { ...res, client };
}

describe("employee self sign-up", () => {
  it("is rejected when no workspace has opened sign-up for the address", async () => {
    await createWorkspace(); // sign-up is off by default
    const { error } = await signUp(`someone@${domain()}`);
    expect(error).not.toBeNull();
  });

  it("joins the open workspace as an employee when the domain is allowed", async () => {
    const d = domain();
    const ws = await createWorkspace({ self_signup_enabled: true, signup_allowed_domains: [d] });
    // A forged role in the metadata has no effect.
    const { data, error, client } = await signUp(`new.hire@${d}`, { full_name: "New Hire", role: "admin" });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull(); // local stack: email confirmation is off
    const { data: member } = await service
      .from("workspace_members")
      .select("workspace_id, role, is_active")
      .eq("user_id", data.user!.id)
      .single();
    expect(member).toEqual({ workspace_id: ws, role: "employee", is_active: true });
    const { data: profile } = await client.from("profiles").select("full_name").eq("id", data.user!.id).single();
    expect(profile!.full_name).toBe("New Hire");
    // They can use the workspace straight away.
    expect((await client.rpc("create_task", { p_task: { title: "My first task" } })).error).toBeNull();
  });

  it("rejects addresses outside the allowed domains", async () => {
    const d = domain();
    await createWorkspace({ self_signup_enabled: true, signup_allowed_domains: [d] });
    expect((await signUp(`intruder@${domain()}`)).error).not.toBeNull();
    expect((await signUp(`sneaky@sub.${d}`)).error).not.toBeNull(); // exact domain match only
  });

  it("with approval required, new accounts start inactive and get no data until approved", async () => {
    const d = domain();
    const ws = await createWorkspace({
      self_signup_enabled: true,
      signup_allowed_domains: [d],
      signup_requires_approval: true,
    });
    const admin = await createUser(ws, "admin");
    const { data: t } = await admin.client.rpc("create_task", { p_task: { title: "Visible after approval" } }).single();

    const { data, error, client } = await signUp(`waiting@${d}`);
    expect(error).toBeNull();
    const { data: own } = await client.from("workspace_members").select("is_active, deactivated_at").single();
    expect(own).toEqual({ is_active: false, deactivated_at: null }); // "awaiting approval"
    expect((await client.from("tasks").select("id").eq("id", t!.id)).data).toEqual([]);

    await admin.client.from("workspace_members").update({ is_active: true }).eq("user_id", data.user!.id);
    expect((await client.from("tasks").select("id").eq("id", t!.id)).data).toHaveLength(1);
  });

  it("an invitation takes precedence over self sign-up (keeps the invited role)", async () => {
    const d = domain();
    const ws = await createWorkspace({ self_signup_enabled: true, signup_allowed_domains: [d] });
    const email = `invited.manager@${d}`;
    await service.from("invitations").insert({ workspace_id: ws, email, role: "manager" });
    const { data } = await signUp(email);
    const { data: member } = await service
      .from("workspace_members")
      .select("role")
      .eq("user_id", data.user!.id)
      .single();
    expect(member!.role).toBe("manager");
  });

  it("normalises and validates the allowed-domain list; only admins can change it", async () => {
    const ws = await createWorkspace();
    const admin = await createUser(ws, "admin");
    const emp = await createUser(ws, "employee");
    const ok = await admin.client
      .from("workspace_settings")
      .update({ self_signup_enabled: true, signup_allowed_domains: [" @Acme.COM ", "acme.com", "acme.in"] })
      .eq("workspace_id", ws)
      .select("signup_allowed_domains")
      .single();
    expect(ok.data!.signup_allowed_domains).toEqual(["acme.com", "acme.in"]);
    const bad = await admin.client
      .from("workspace_settings")
      .update({ signup_allowed_domains: ["not a domain"] })
      .eq("workspace_id", ws);
    expect(bad.error?.message).toMatch(/invalid email domain/i);
    const { data: denied } = await emp.client
      .from("workspace_settings")
      .update({ signup_allowed_domains: [] })
      .eq("workspace_id", ws)
      .select();
    expect(denied ?? []).toEqual([]);
    // Turn it back off so later tests don't sign up into this workspace.
    await admin.client.from("workspace_settings").update({ self_signup_enabled: false }).eq("workspace_id", ws);
  });
});

describe("open sign-up defaults", () => {
  it("new workspaces are open to sign-up by default, with no domain limit and no approval", async () => {
    const { rows } = await sql<{ column_name: string; column_default: string }>(
      `select column_name, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'workspace_settings'
          and column_name in ('self_signup_enabled', 'signup_requires_approval', 'signup_allowed_domains')
        order by column_name`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.column_name, r.column_default]))).toEqual({
      self_signup_enabled: "true",
      signup_allowed_domains: "'{}'::text[]",
      signup_requires_approval: "false",
    });
  });

  it("on a fresh installation the first sign-up becomes admin and the next one an employee", async () => {
    // Simulate an empty database inside a transaction that is always rolled back.
    const db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    try {
      await db.query("begin");
      await db.query("set local saunf.allow_audit_purge = 'on'");
      await db.query("delete from public.workspaces");
      const first = randomUUID();
      const second = randomUUID();
      for (const [id, email] of [
        [first, `first-${first.slice(0, 8)}@example.test`],
        [second, `second-${second.slice(0, 8)}@other.test`],
      ]) {
        await db.query(
          "insert into auth.users (id, email, aud, role, instance_id) values ($1, $2, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')",
          [id, email],
        );
      }
      const { rows } = await db.query(
        `select m.user_id, m.role, m.is_active, w.slug, s.self_signup_enabled
           from public.workspace_members m
           join public.workspaces w on w.id = m.workspace_id
           join public.workspace_settings s on s.workspace_id = w.id
          where m.user_id = any($1::uuid[])`,
        [[first, second]],
      );
      const byUser = Object.fromEntries(rows.map((r) => [r.user_id, r]));
      expect(byUser[first]).toMatchObject({
        role: "admin",
        is_active: true,
        slug: "workspace",
        self_signup_enabled: true,
      });
      expect(byUser[second]).toMatchObject({ role: "employee", is_active: true, slug: "workspace" });
    } finally {
      await db.query("rollback");
      await db.end();
    }
  });
});
