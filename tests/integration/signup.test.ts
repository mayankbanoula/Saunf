import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { anonClient, cleanup, createUser, createWorkspace, PASSWORD, service, trackUser } from "./helpers";

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
