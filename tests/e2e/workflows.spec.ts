import { expect, test, type Page } from "@playwright/test";

import { buildWorld, cleanup, createTask, createUser, PASSWORD, service } from "../integration/helpers";

let w: Awaited<ReturnType<typeof buildWorld>>;

test.beforeAll(async () => {
  w = await buildWorld();
});
test.afterAll(cleanup);

async function login(page: Page, email: string, password = PASSWORD, { expectSuccess = true } = {}) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (expectSuccess) await page.waitForURL(/\/dashboard/);
}

test("anonymous visitors are sent to the login page and back after signing in", async ({ page }) => {
  await page.goto("/tasks?status=todo");
  await expect(page).toHaveURL(/\/login\?next=%2Ftasks%3Fstatus%3Dtodo/);
  await page.getByLabel("Work email").fill(w.emp1.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/tasks\?status=todo/);
  await expect(page.getByRole("heading", { name: "All tasks" })).toBeVisible();
});

test("wrong passwords are rejected without revealing which part was wrong", async ({ page }) => {
  await login(page, w.emp1.email, "wrong-password", { expectSuccess: false });
  await expect(page.locator("form [role=alert]")).toHaveText("Incorrect email or password.");
  await expect(page).toHaveURL(/\/login/);
});

test("an employee creates, works on, comments on and completes a task", async ({ page }) => {
  await login(page, w.emp1.email);

  await page.getByRole("button", { name: "Create task" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("Prepare onboarding checklist");
  await dialog.getByLabel("Description").fill("Steps for new joiners in week one.");
  await dialog.getByLabel("Assignee").selectOption({ label: "Esha Employee (me)" });
  await dialog.getByLabel("Priority").selectOption("high");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();

  await page.goto("/my-tasks");
  await page.getByRole("link", { name: "Prepare onboarding checklist" }).click();
  await expect(page.getByRole("heading", { name: /Prepare onboarding checklist/ })).toBeVisible();
  const key = (await page.locator("h1 .font-mono").textContent())!.trim();
  expect(key).toMatch(/^SAU-\d{5}$/);

  // Status change through the sidebar control.
  await page.getByLabel("Status", { exact: true }).selectOption("in_progress");
  await expect(page.getByText("Status changed to In progress")).toBeVisible();

  // Comment with an @mention.
  await page.getByLabel("New comment").fill("Draft ready, @Manu");
  await page.getByRole("option", { name: /Manu Manager/ }).click();
  await page.getByLabel("New comment").press("End");
  await page.getByLabel("New comment").pressSequentially("please review.");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.locator("#comments").getByText("@Manu Manager")).toBeVisible();

  await page.getByRole("button", { name: "Complete" }).click();
  await expect(page.getByText(`${key} completed`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
  const history = page
    .getByRole("region", { name: "History" })
    .or(page.locator("section[aria-labelledby=history-heading]"));
  await expect(history.getByText("created this task")).toBeVisible();
  await expect(history.getByText("changed the status from To do to In progress")).toBeVisible();
  await expect(history.getByText("completed this task")).toBeVisible();

  // The mentioned manager was notified.
  const { data } = await service
    .from("notifications")
    .select("type")
    .eq("recipient_id", w.manager.id)
    .eq("type", "mentioned");
  expect(data?.length).toBeGreaterThan(0);
});

test("dragging a card on the board changes its status and persists", async ({ page }) => {
  const t = await createTask(w.manager, { title: "Board drag target", assignee_id: w.emp1.id });
  await login(page, w.emp1.email);
  await page.goto("/my-tasks?view=board");
  const card = page.locator("article", { hasText: "Board drag target" });
  const done = page.getByRole("region", { name: "Done column" });
  await card.hover();
  await page.mouse.down();
  const box = (await done.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 80, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText(`${t.key} moved to Done`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Done column" }).getByText("Board drag target")).toBeVisible();
  const { data } = await service.from("tasks").select("status, progress").eq("id", t.id).single();
  expect(data).toEqual({ status: "done", progress: 100 });
});

test("notifications show an unread count and open the related task", async ({ page }) => {
  const t = await createTask(w.manager, { title: "Please handle this", assignee_id: w.emp2.id });
  await login(page, w.emp2.email);
  const bell = page.getByRole("button", { name: /Notifications, \d+ unread/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await page.getByRole("button", { name: new RegExp(`assigned you ${t.key}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${t.key}`));
  const { data } = await service
    .from("notifications")
    .select("read_at")
    .eq("task_id", t.id)
    .eq("recipient_id", w.emp2.id)
    .single();
  expect(data!.read_at).not.toBeNull();
});

test("an admin adds an employee who can then sign in; deactivation removes access", async ({ page, browser }) => {
  const email = `new-hire-${Date.now()}@test.saunf.local`;
  await login(page, w.admin.email);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Add employee" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Nina Newhire");
  await dialog.getByLabel("Work email").fill(email);
  await dialog.getByLabel("Create the account with a temporary password").check();
  await dialog.getByLabel("Temporary password", { exact: true }).fill("Temp-pass-456");
  await dialog.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(`Account created for ${email}`)).toBeVisible();
  await expect(page.getByText("Nina Newhire", { exact: true })).toBeVisible();

  const other = await browser.newContext();
  const newbie = await other.newPage();
  await login(newbie, email, "Temp-pass-456");
  await expect(newbie.getByRole("heading", { name: "Welcome back, Nina" })).toBeVisible();

  // Deactivate from the admin panel.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("switch", { name: "Deactivate Nina Newhire" }).click();
  await expect(page.getByText("Member deactivated")).toBeVisible();

  // Existing session: data access is gone immediately.
  await newbie.goto("/tasks");
  await expect(newbie).toHaveURL(/\/no-access|\/login/);
  // New sign-ins are refused.
  const fresh = await (await browser.newContext()).newPage();
  await login(fresh, email, "Temp-pass-456", { expectSuccess: false });
  await expect(fresh.locator("form [role=alert]")).toContainText("deactivated");
  const { data: user } = await service.from("profiles").select("id").eq("email", email).single();
  await service.auth.admin.deleteUser(user!.id).catch(() => undefined);
});

test("employees can't open the admin panel", async ({ page }) => {
  await login(page, w.emp1.email);
  await expect(page.getByRole("link", { name: "Admin Panel" })).toHaveCount(0);
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/dashboard\?denied=1/);
});

test("signing out ends the session", async ({ page }) => {
  await login(page, w.emp2.email);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("the mobile layout uses a navigation drawer", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await login(page, w.emp1.email);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByRole("dialog")).toBeHidden();
  const t = await createTask(w.emp1, { title: "Mobile check", assignee_id: w.emp1.id, due_date: "2030-01-01" });
  for (const path of [
    "/dashboard",
    "/my-tasks",
    "/tasks?view=board",
    "/calendar",
    "/reports",
    "/team",
    `/tasks/${t.key}`,
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
});

test("the email cron endpoint rejects requests without the secret", async ({ request }) => {
  expect((await request.get("/api/cron/email-notifications")).status()).toBe(401);
  const ok = await request.get("/api/cron/email-notifications", {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ configured: false });
});

test("users created by the helper match the app's invitation flow", async () => {
  const u = await createUser(w.ws, "employee");
  const { data } = await service.from("workspace_members").select("role, is_active").eq("user_id", u.id).single();
  expect(data).toEqual({ role: "employee", is_active: true });
});

test("employees can sign up with a work email; other domains are refused", async ({ page }) => {
  const domain = `e2e-${Date.now()}.test`;
  await service
    .from("workspace_settings")
    .update({ self_signup_enabled: true, signup_allowed_domains: [domain], signup_requires_approval: false })
    .eq("workspace_id", w.ws);
  try {
    await page.goto("/login");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup/);

    await page.getByLabel("Full name").fill("Outside Person");
    await page.getByLabel("Work email").fill(`someone@gmail-${Date.now()}.test`);
    await page.getByLabel("Password").fill("Signup-pass-1");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.locator("form [role=alert]")).toContainText("Sign-up isn't open for this email address");

    const email = `sam.signup@${domain}`;
    await page.getByLabel("Full name").fill("Sam Signup");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill("Signup-pass-1");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Welcome back, Sam" })).toBeVisible();

    const { data } = await service.from("profiles").select("id").eq("email", email).single();
    const { data: m } = await service.from("workspace_members").select("role").eq("user_id", data!.id).single();
    expect(m!.role).toBe("employee");
    await service.auth.admin.deleteUser(data!.id).catch(() => undefined);
  } finally {
    await service.from("workspace_settings").update({ self_signup_enabled: false }).eq("workspace_id", w.ws);
  }
});

test("with approval required, a sign-up waits until an admin approves it", async ({ page, browser }) => {
  const domain = `e2e-approve-${Date.now()}.test`;
  await service
    .from("workspace_settings")
    .update({ self_signup_enabled: true, signup_allowed_domains: [domain], signup_requires_approval: true })
    .eq("workspace_id", w.ws);
  const email = `pat.pending@${domain}`;
  try {
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Pat Pending");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill("Signup-pass-1");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("waiting for an administrator to approve it")).toBeVisible();

    const admin = await (await browser.newContext()).newPage();
    await login(admin, w.admin.email);
    await admin.goto("/admin");
    await expect(admin.getByText("Awaiting approval", { exact: true })).toBeVisible();
    await admin
      .getByRole("row", { name: /Pat Pending/ })
      .getByRole("button", { name: "Approve" })
      .click();
    await expect(admin.getByText("Member approved")).toBeVisible();

    await login(page, email, "Signup-pass-1");
    await expect(page.getByRole("heading", { name: "Welcome back, Pat" })).toBeVisible();
  } finally {
    await service.from("workspace_settings").update({ self_signup_enabled: false }).eq("workspace_id", w.ws);
    const { data } = await service.from("profiles").select("id").eq("email", email).maybeSingle();
    if (data) await service.auth.admin.deleteUser(data.id).catch(() => undefined);
  }
});
