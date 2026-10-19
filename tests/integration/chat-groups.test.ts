import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildWorld, cleanup, createUser, service } from "./helpers";

let w: Awaited<ReturnType<typeof buildWorld>>;

beforeAll(async () => {
  w = await buildWorld();
});
afterAll(cleanup);

const post = (who: typeof w.emp1, groupId: string, body: string) =>
  who.client.from("group_messages").insert({ group_id: groupId, sender_id: who.id, body });
const bodies = async (who: typeof w.emp1, groupId: string) =>
  ((await who.client.from("group_messages").select("body").eq("group_id", groupId).order("created_at")).data ?? []).map(
    (m) => m.body,
  );

describe("group chats", () => {
  it("only members can read or post — not admins, not managers", async () => {
    const { data: g, error } = await w.emp1.client.rpc("create_chat_group", {
      p_name: "Launch crew",
      p_members: [w.emp2.id],
    });
    expect(error).toBeNull();
    expect((await post(w.emp1, g!, "Kick-off at 11")).error).toBeNull();
    expect((await post(w.emp2, g!, "👍")).error).toBeNull();

    expect(await bodies(w.emp2, g!)).toEqual(["Kick-off at 11", "👍"]);
    expect(await bodies(w.admin, g!)).toEqual([]);
    expect(await bodies(w.manager, g!)).toEqual([]);
    expect((await w.admin.client.from("chat_groups").select("id").eq("id", g!)).data).toEqual([]);
    expect((await post(w.admin, g!, "Hi")).error).not.toBeNull();
    // No impersonation.
    expect(
      (await w.emp2.client.from("group_messages").insert({ group_id: g!, sender_id: w.emp1.id, body: "x" })).error,
    ).not.toBeNull();
    // Nothing leaks into the activity log.
    const { data: events } = await service
      .from("activity_events")
      .select("metadata, new_value")
      .eq("workspace_id", w.ws);
    expect(JSON.stringify(events)).not.toMatch(/Kick-off|Launch crew/);
  });

  it("the creator manages members; others can only leave", async () => {
    const { data: g } = await w.emp1.client.rpc("create_chat_group", { p_name: "Ops", p_members: [w.emp2.id] });
    // emp2 (not the creator) can't add people or rename.
    expect(
      (await w.emp2.client.rpc("add_chat_group_members", { p_group: g!, p_members: [w.manager.id] })).error,
    ).not.toBeNull();
    expect((await w.emp2.client.rpc("rename_chat_group", { p_group: g!, p_name: "Mine" })).error).not.toBeNull();

    // The creator adds the manager, who then sees earlier messages.
    await post(w.emp1, g!, "Before you joined");
    expect(
      (await w.emp1.client.rpc("add_chat_group_members", { p_group: g!, p_members: [w.manager.id] })).error,
    ).toBeNull();
    expect(await bodies(w.manager, g!)).toEqual(["Before you joined"]);

    // Leaving removes access.
    expect((await w.emp2.client.rpc("remove_chat_group_member", { p_group: g!, p_user: w.emp2.id })).error).toBeNull();
    expect(await bodies(w.emp2, g!)).toEqual([]);
    expect((await post(w.emp2, g!, "still here?")).error).not.toBeNull();

    // Can't add people from another workspace.
    expect(
      (await w.emp1.client.rpc("add_chat_group_members", { p_group: g!, p_members: [w.outsider.id] })).error,
    ).not.toBeNull();
  });

  it("counts unread groups for each member", async () => {
    const extra = await createUser(w.ws, "employee", { name: "Gita Group" });
    const { data: g } = await w.emp1.client.rpc("create_chat_group", { p_name: "Unread", p_members: [extra.id] });
    const unread = async (who: typeof w.emp1) => (await who.client.rpc("unread_conversation_count")).data;
    expect(await unread(extra)).toBe(0);
    const senderBefore = await unread(w.emp1);
    await post(w.emp1, g!, "ping");
    expect(await unread(extra)).toBe(1);
    expect(await unread(w.emp1)).toBe(senderBefore); // sending doesn't mark it unread for the sender
    await extra.client.rpc("mark_chat_group_read", { p_group: g! });
    expect(await unread(extra)).toBe(0);
  });
});
