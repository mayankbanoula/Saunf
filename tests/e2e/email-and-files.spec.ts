import { expect, test, type Page } from "@playwright/test";

import { buildWorld, cleanup, createTask, PASSWORD, service } from "../integration/helpers";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
let w: Awaited<ReturnType<typeof buildWorld>>;

test.beforeAll(async () => {
  w = await buildWorld();
});
test.afterAll(cleanup);

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

/** Wait for the newest email to `to` in the local Mailpit inbox and return the auth link in it. */
async function linkFromEmail(to: string, baseURL: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages?.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string };
      const href = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(msg.HTML)?.[1];
      if (href) {
        const url = new URL(href.replaceAll("&amp;", "&"));
        return `${baseURL}${url.pathname}${url.search}`; // the template uses the configured site URL
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email for ${to}`);
}

test("forgot password → email link → new password → sign in", async ({ page, baseURL }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Work email").fill(w.emp2.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If an account exists for that email")).toBeVisible();

  await page.goto(await linkFromEmail(w.emp2.email, baseURL!));
  await expect(page).toHaveURL(/\/reset-password/);
  await page.getByLabel("New password").fill("Brand-new-pass-1");
  await page.getByLabel("Confirm password").fill("Brand-new-pass-1");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const ctx = await page.context().browser()!.newContext();
  const fresh = await ctx.newPage();
  await login(fresh, w.emp2.email, "Brand-new-pass-1");
  await expect(fresh.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
});

test("an invalid or reused email link is rejected", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=not-a-real-token&type=recovery&next=/reset-password");
  await expect(page).toHaveURL(/\/login\?error=link/);
  await expect(page.getByText("That link is invalid or has expired")).toBeVisible();
});

test("an emailed invitation lets the new employee set a password and join with the chosen role", async ({
  page,
  baseURL,
  browser,
}) => {
  const email = `invitee-${Date.now()}@test.saunf.local`;
  await login(page, w.admin.email);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Add employee" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Ivy Invitee");
  await dialog.getByLabel("Work email").fill(email);
  await dialog.getByLabel("Role").selectOption("manager");
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible();
  await page.goto("/admin/invitations");
  await expect(page.getByRole("row", { name: /Ivy Invitee/ })).toContainText("Pending");

  const invitee = await (await browser.newContext()).newPage();
  await invitee.goto(await linkFromEmail(email, baseURL!));
  await expect(invitee).toHaveURL(/\/set-password/);
  await expect(invitee.getByLabel("Your name")).toHaveValue("Ivy Invitee");
  await invitee.getByLabel("New password").fill("Invitee-pass-1");
  await invitee.getByLabel("Confirm password").fill("Invitee-pass-1");
  await invitee.getByRole("button", { name: "Set password and continue" }).click();
  await expect(invitee).toHaveURL(/\/dashboard/);

  const { data: profile } = await service.from("profiles").select("id").eq("email", email).single();
  const { data: member } = await service
    .from("workspace_members")
    .select("role, workspace_id")
    .eq("user_id", profile!.id)
    .single();
  expect(member).toEqual({ role: "manager", workspace_id: w.ws });
  const { data: inv } = await service.from("invitations").select("status").eq("email", email).single();
  expect(inv!.status).toBe("accepted");
  await service.auth.admin.deleteUser(profile!.id).catch(() => undefined);
});

test("attachments upload to private storage and download through a signed link", async ({ page }) => {
  const t = await createTask(w.emp1, { title: "Attach the brief", assignee_id: w.emp1.id });
  await login(page, w.emp1.email);
  await page.goto(`/tasks/${t.key}`);
  await page.waitForLoadState("networkidle"); // let React hydrate before picking a file
  await page.getByLabel("Choose file to attach").setInputFiles({
    name: "brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Project brief v1"),
  });
  await expect(page.getByText("brief.txt attached")).toBeVisible();
  await expect(page.getByText("brief.txt", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download brief.txt" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("brief.txt");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  expect(Buffer.concat(chunks).toString()).toBe("Project brief v1");

  // Disallowed types are refused before upload.
  await page
    .getByLabel("Choose file to attach")
    .setInputFiles({ name: "x.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") });
  await expect(page.getByText("This file type isn't allowed.")).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove brief.txt" }).click();
  await expect(page.getByText("Attachment removed")).toBeVisible();
  const { data } = await service.from("task_attachments").select("id").eq("task_id", t.id);
  expect(data).toEqual([]);
});

// Supabase's default templates (used on hosted projects until custom SMTP is set up) link to
// /auth/v1/verify, which redirects back with the session in the URL #fragment.
test("default-template invite links (session in #fragment) still sign the person in", async ({ page, baseURL }) => {
  const email = `default-tpl-${Date.now()}@test.saunf.local`;
  await service.from("invitations").insert({ workspace_id: w.ws, email, role: "employee", full_name: "Dee Fault" });
  const { data, error } = await service.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo: `${baseURL}/auth/confirm?next=/set-password` },
  });
  expect(error).toBeNull();
  await page.goto(data.properties!.action_link);
  await expect(page).toHaveURL(/\/set-password/);
  await page.getByLabel("New password").fill("Default-tpl-1");
  await page.getByLabel("Confirm password").fill("Default-tpl-1");
  await page.getByRole("button", { name: "Set password and continue" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await service.auth.admin.deleteUser(data.user!.id).catch(() => undefined);
});

test("default-template password reset links work too", async ({ page, baseURL }) => {
  const { data, error } = await service.auth.admin.generateLink({
    type: "recovery",
    email: w.emp1.email,
    options: { redirectTo: `${baseURL}/auth/confirm?next=/reset-password` },
  });
  expect(error).toBeNull();
  await page.goto(data.properties!.action_link);
  await expect(page).toHaveURL(/\/reset-password/);
  await page.getByLabel("New password").fill(PASSWORD + "x");
  await page.getByLabel("Confirm password").fill(PASSWORD + "x");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("a fragment link without a session goes back to login", async ({ page }) => {
  await page.goto("/auth/confirm?next=/set-password#error=access_denied&error_code=otp_expired");
  await expect(page).toHaveURL(/\/login\?error=link/);
});
