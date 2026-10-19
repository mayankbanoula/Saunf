import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildWorld, cleanup, service } from "./helpers";

let w: Awaited<ReturnType<typeof buildWorld>>;

beforeAll(async () => {
  w = await buildWorld();
  // emp1 reports to the manager: even a manager can't read their reportee's messages.
  await service.from("workspace_members").update({ reports_to: w.manager.id }).eq("user_id", w.emp1.id);
});
afterAll(cleanup);

const open = async (from: typeof w.emp1, to: typeof w.emp1) => {
  const { data, error } = await from.client.rpc("open_conversation", { p_other: to.id });
  if (error) throw error;
  return data;
};
const send = (from: typeof w.emp1, conversationId: string, body: string) =>
  from.client.from("messages").insert({ conversation_id: conversationId, sender_id: from.id, body });

describe("private messages", () => {
  it("only the two people in a conversation can read it — not admins or managers", async () => {
    const c = await open(w.emp1, w.emp2);
    expect(await open(w.emp2, w.emp1)).toBe(c); // one conversation per pair
    expect((await send(w.emp1, c, "Lunch at 1?")).error).toBeNull();
    expect((await send(w.emp2, c, "Sure")).error).toBeNull();

    const read = async (who: typeof w.emp1) =>
      (await who.client.from("messages").select("body").eq("conversation_id", c).order("created_at")).data ?? [];
    expect((await read(w.emp1)).map((m) => m.body)).toEqual(["Lunch at 1?", "Sure"]);
    expect(await read(w.emp2)).toHaveLength(2);
    expect(await read(w.admin)).toEqual([]);
    expect(await read(w.manager)).toEqual([]);
    expect(await read(w.outsider)).toEqual([]);
    expect((await w.admin.client.from("conversations").select("id").eq("id", c)).data).toEqual([]);

    // Messages never reach the activity log.
    const { data: events } = await service.from("activity_events").select("event_type").eq("workspace_id", w.ws);
    expect(JSON.stringify(events)).not.toMatch(/Lunch/);
  });

  it("outsiders can't post into a conversation or impersonate a sender", async () => {
    const c = await open(w.emp1, w.emp2);
    expect((await send(w.admin, c, "Admin here")).error).not.toBeNull();
    expect(
      (await w.emp2.client.from("messages").insert({ conversation_id: c, sender_id: w.emp1.id, body: "fake" })).error,
    ).not.toBeNull();
    expect(
      (await w.emp1.client.from("messages").update({ body: "edited" }).eq("conversation_id", c)).error,
    ).not.toBeNull();
  });

  it("can't message yourself or someone from another workspace", async () => {
    expect((await w.emp1.client.rpc("open_conversation", { p_other: w.emp1.id })).error).not.toBeNull();
    expect((await w.emp1.client.rpc("open_conversation", { p_other: w.outsider.id })).error).not.toBeNull();
  });

  it("tracks unread conversations per person", async () => {
    const c = await open(w.manager, w.emp2);
    await send(w.manager, c, "Got a minute?");
    const unread = async (who: typeof w.emp1) => (await who.client.rpc("unread_conversation_count")).data;
    expect(await unread(w.manager)).toBe(0); // sending marks it read for the sender
    const before = await unread(w.emp2);
    expect(before).toBeGreaterThan(0);
    await w.emp2.client.rpc("mark_conversation_read", { p_conversation: c });
    expect(await unread(w.emp2)).toBe(before! - 1);
    // Only participants can mark it read.
    expect((await w.admin.client.rpc("mark_conversation_read", { p_conversation: c })).error).not.toBeNull();
  });
});
