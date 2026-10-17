/**
 * LOCAL DEVELOPMENT ONLY: fill a workspace with demo people, projects and tasks.
 *
 *   npm run seed:demo            (refuses to run against a non-local Supabase URL)
 *
 * Accounts are created through Supabase Auth, and every task action is performed
 * by signing in as the acting user and calling the same RPCs the app uses — so
 * activity history, assignment history and notifications are produced by the
 * real triggers. All demo users share the password "Demo-pass-123".
 * Requires an existing workspace (run `npm run bootstrap` first).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

import type { Database } from "../src/lib/database.types";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "Demo-pass-123";

if (!url || !anon || !secret) throw new Error("Supabase env vars missing (.env.local)");
if (!/127\.0\.0\.1|localhost/.test(url) && !process.argv.includes("--force")) {
  throw new Error(`Refusing to seed demo data into ${url}. Pass --force if you really mean it.`);
}

const admin = createClient<Database>(url, secret, { auth: { persistSession: false } });

type DemoUser = { key: string; name: string; email: string; role: "admin" | "manager" | "employee"; dept: string; title: string };
const USERS: DemoUser[] = [
  { key: "rahul", name: "Rahul Mehta", email: "rahul@saunf.local", role: "manager", dept: "Engineering", title: "Engineering Manager" },
  { key: "priya", name: "Priya Nair", email: "priya@saunf.local", role: "employee", dept: "Engineering", title: "Frontend Engineer" },
  { key: "dev", name: "Dev Kapoor", email: "dev@saunf.local", role: "employee", dept: "Engineering", title: "Backend Engineer" },
  { key: "meera", name: "Meera Iyer", email: "meera@saunf.local", role: "employee", dept: "Design", title: "Product Designer" },
  { key: "arjun", name: "Arjun Shah", email: "arjun@saunf.local", role: "manager", dept: "Finance", title: "Finance Lead" },
  { key: "kabir", name: "Kabir Singh", email: "kabir@saunf.local", role: "employee", dept: "Operations", title: "Operations Associate" },
];

const iso = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

async function signIn(email: string, password: string) {
  const c = createClient<Database>(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as NonNullable<T>;
}

async function main() {
  const { data: ws } = await admin.from("workspaces").select("id, name").order("created_at").limit(1).single();
  if (!ws) throw new Error("No workspace found. Run `npm run bootstrap` first.");
  const { data: adminMember } = await admin
    .from("workspace_members")
    .select("user_id, profiles!workspace_members_user_id_fkey(email)")
    .eq("workspace_id", ws.id)
    .eq("role", "admin")
    .limit(1)
    .single();
  if (!adminMember) throw new Error("Workspace has no admin.");
  console.log(`Seeding "${ws.name}"…`);

  const { count } = await admin.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id);
  if ((count ?? 0) > 0 && !process.argv.includes("--again")) {
    console.log("Workspace already has tasks; skipping (pass --again to add more).");
    return;
  }

  // Departments
  const deptIds: Record<string, string> = {};
  for (const name of ["Engineering", "Design", "Finance", "Operations"]) {
    const { data: existing } = await admin.from("departments").select("id").eq("workspace_id", ws.id).eq("name", name).maybeSingle();
    deptIds[name] = existing?.id ?? (await must(admin.from("departments").insert({ workspace_id: ws.id, name }).select("id").single(), `dept ${name}`)).id;
  }

  // People (invitation → auth user → membership via trigger)
  const ids: Record<string, string> = {};
  for (const u of USERS) {
    const { data: prof } = await admin.from("profiles").select("id").eq("email", u.email).maybeSingle();
    if (prof) {
      ids[u.key] = prof.id;
      continue;
    }
    await admin.from("invitations").insert({ workspace_id: ws.id, email: u.email, role: u.role, department_id: deptIds[u.dept], full_name: u.name });
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: u.name } });
    if (error) throw new Error(`create ${u.email}: ${error.message}`);
    ids[u.key] = data.user.id;
    await admin.from("profiles").update({ job_title: u.title }).eq("id", data.user.id);
    await admin.from("invitations").update({ status: "accepted" }).eq("email", u.email).eq("status", "pending");
  }
  ids.admin = adminMember.user_id;
  await admin.from("departments").update({ manager_id: ids.rahul }).eq("id", deptIds.Engineering);
  await admin.from("departments").update({ manager_id: ids.arjun }).eq("id", deptIds.Finance);
  await admin.from("workspace_members").update({ department_id: deptIds.Operations }).eq("user_id", ids.admin);

  const as: Record<string, SupabaseClient<Database>> = {};
  for (const u of USERS) as[u.key] = await signIn(u.email, PASSWORD);

  // Projects (created by managers)
  const project = async (who: string, name: string, description: string, extra: Partial<Database["public"]["Tables"]["projects"]["Insert"]> = {}) =>
    (await must(as[who].from("projects").insert({ workspace_id: ws.id, name, description, owner_id: ids[who], ...extra }).select("id").single(), `project ${name}`)).id;
  const web = await project("rahul", "Website relaunch", "New marketing site and customer portal.", { start_date: iso(-30), target_date: iso(45) });
  const close = await project("arjun", "Q4 financial close", "Quarter-end close checklist. Finance only.", { is_private: true, target_date: iso(20) });
  const office = await project("rahul", "Office move", "Move to the new Indiranagar office.", { status: "planning", target_date: iso(60) });
  await as.rahul.from("project_members").insert([
    { project_id: web, user_id: ids.priya, workspace_id: ws.id, role: "lead" },
    { project_id: web, user_id: ids.dev, workspace_id: ws.id },
    { project_id: web, user_id: ids.meera, workspace_id: ws.id },
    { project_id: office, user_id: ids.kabir, workspace_id: ws.id, role: "lead" },
  ]);
  await as.arjun.from("project_members").insert({ project_id: close, user_id: ids.arjun, workspace_id: ws.id, role: "lead" });

  // Labels
  const labelIds: Record<string, string> = {};
  for (const [name, color] of [["frontend", "#2f6f9f"], ["backend", "#4d7c5a"], ["bug", "#c2410c"], ["design", "#9b4d96"], ["finance", "#b7791f"]] as const) {
    labelIds[name] = (await must(as.rahul.from("labels").insert({ workspace_id: ws.id, name, color, created_by: ids.rahul }).select("id").single(), `label ${name}`)).id;
  }

  type T = {
    by: string; title: string; to?: string; project?: string; priority?: "low" | "medium" | "high" | "urgent";
    due?: number; start?: number; labels?: string[]; collab?: string[]; desc?: string;
    then?: [string, Record<string, unknown>][]; comments?: [string, string, string[]?][];
  };
  const tasks: T[] = [
    { by: "rahul", title: "Set up CI pipeline for the new site", to: "dev", project: web, priority: "high", due: -2, start: -10, labels: ["backend"], then: [["dev", { status: "in_progress", progress: 60 }]] },
    { by: "rahul", title: "Implement responsive navigation", to: "priya", project: web, priority: "medium", due: 3, labels: ["frontend"], then: [["priya", { status: "in_progress", progress: 40 }]], comments: [["priya", "Started with the mobile drawer. @Meera Iyer can you share the final icons?", ["meera"]], ["meera", "Uploaded to the design folder — ping me if anything is missing."]] },
    { by: "priya", title: "Fix layout shift on pricing page", to: "priya", project: web, priority: "urgent", due: 0, labels: ["frontend", "bug"], then: [["priya", { status: "in_review", progress: 90 }]] },
    { by: "meera", title: "Design system tokens for colour and type", to: "meera", project: web, priority: "high", due: -5, labels: ["design"], then: [["meera", { status: "done" }]] },
    { by: "rahul", title: "Customer portal login flow", to: "dev", project: web, priority: "high", due: 10, start: 2, labels: ["backend"], collab: ["priya"] },
    { by: "rahul", title: "Write API documentation", to: "dev", project: web, priority: "low", due: 21 },
    { by: "meera", title: "Homepage hero illustrations", to: "meera", project: web, priority: "medium", due: 6, labels: ["design"], then: [["meera", { status: "in_progress", progress: 30 }]] },
    { by: "dev", title: "Database backup verification", to: "dev", priority: "high", due: -1, labels: ["backend"], then: [["dev", { is_blocked: true, blocker_description: "Waiting for staging credentials from Ops" }]] },
    { by: "arjun", title: "Reconcile vendor invoices", to: "arjun", project: close, priority: "high", due: 4, labels: ["finance"], then: [["arjun", { status: "in_progress", progress: 50 }]] },
    { by: "arjun", title: "Prepare Q3 management report", to: "arjun", project: close, priority: "urgent", due: 1, labels: ["finance"] },
    { by: "ananya", title: "Renew office internet contract", to: "kabir", project: office, priority: "medium", due: 12 },
    { by: "rahul", title: "Plan seating layout", to: "kabir", project: office, priority: "low", due: 30, collab: ["meera"] },
    { by: "kabir", title: "Get quotes from three moving companies", to: "kabir", project: office, priority: "medium", due: -3, then: [["kabir", { status: "done" }]] },
    { by: "ananya", title: "Update leave policy document", to: "ananya", priority: "medium", due: 7 },
    { by: "ananya", title: "Quarterly all-hands agenda", to: "rahul", priority: "medium", due: 2, then: [["rahul", { status: "in_progress", progress: 20 }]], comments: [["rahul", "I'll add an engineering roadmap segment."]] },
    { by: "priya", title: "Accessibility audit of forms", priority: "high", due: 14, labels: ["frontend"] },
    { by: "rahul", title: "Onboarding checklist for new engineers", to: "priya", priority: "low", then: [["priya", { status: "done" }]] },
  ];

  for (const t of tasks) {
    const creator = t.by === "ananya" ? null : as[t.by];
    const client = creator ?? (await signIn(adminMember.profiles!.email, process.env.SEED_ADMIN_PASSWORD ?? "Admin-pass-123"));
    const created = await must(
      client
        .rpc("create_task", {
          p_task: {
            title: t.title,
            description: t.desc ?? `Demo task: ${t.title.toLowerCase()}.`,
            priority: t.priority ?? "medium",
            assignee_id: t.to ? (t.to === "ananya" ? ids.admin : ids[t.to]) : null,
            project_id: t.project ?? null,
            due_date: t.due === undefined ? null : iso(t.due),
            start_date: t.start === undefined ? null : iso(t.start),
          },
          p_label_ids: (t.labels ?? []).map((l) => labelIds[l]),
          p_collaborator_ids: (t.collab ?? []).map((c) => ids[c]),
        })
        .single(),
      `task ${t.title}`,
    );
    for (const [who, patch] of t.then ?? []) {
      await must(as[who].rpc("update_task", { p_task_id: created.id, p_patch: patch as never }), `update ${t.title}`);
    }
    for (const [who, body, mentions] of t.comments ?? []) {
      await must(
        as[who].from("task_comments").insert({
          task_id: created.id,
          workspace_id: ws.id,
          author_id: ids[who],
          body,
          mentioned_user_ids: (mentions ?? []).map((m) => ids[m]),
        }),
        `comment on ${t.title}`,
      );
    }
    console.log(`  ${created.key}  ${t.title}`);
  }
  // A reassignment with a note, so the assignment history has depth.
  const { data: docs } = await admin.from("tasks").select("id").eq("title", "Write API documentation").single();
  if (docs) await must(as.rahul.rpc("update_task", { p_task_id: docs.id, p_patch: { assignee_id: ids.priya }, p_note: "Dev is focused on the portal login" }), "reassign");

  console.log(`✔ Demo data ready. Demo users (password ${PASSWORD}): ${USERS.map((u) => u.email).join(", ")}`);
}

main().catch((e) => {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exit(1);
});
