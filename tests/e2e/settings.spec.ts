import { expect, test } from "@playwright/test";
import { MEMBER_ID } from "./support/fake-supabase";
import { signInAs } from "./support/session";

const FAKE = "http://127.0.0.1:54399";
const log = async () => (await (await fetch(`${FAKE}/__log`)).json()) as string[];

test.beforeEach(async ({ context, baseURL }) => {
  await fetch(`${FAKE}/__reset`, { method: "POST" });
  await signInAs(context, MEMBER_ID, baseURL!);
});

test("saves listening defaults to the profile", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Reference pitch (A4)").fill("442");
  await page.getByLabel("Save results to my history automatically").uncheck();
  await page.getByRole("button", { name: "Save listening settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  const update = (await log()).find((l) => l.startsWith("update profiles"));
  expect(update).toContain('"a4Hz":442');
  expect(update).toContain('"saveHistory":false');
  expect(update).toContain('"sensitivityDb":12');
});

test("refuses an out-of-range A4", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Reference pitch (A4)").fill("500");
  await page.getByRole("button", { name: "Save listening settings" }).click();
  await expect(page.getByText(/between 400 and 480 Hz/)).toBeVisible();
  expect((await log()).some((l) => l.startsWith("update profiles"))).toBe(false);
});

test("deletes the account only after typing DELETE, then signs out", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByText("Type DELETE (in capitals) to confirm.")).toBeVisible();
  expect((await log()).some((l) => l.startsWith("delete user"))).toBe(false);

  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL(/\/sign-in\?notice=account-deleted/);
  await expect(page.getByText("Your account and history have been deleted.")).toBeVisible();
  expect(await log()).toContain(`delete user ${MEMBER_ID}`);
  // The session cookie is gone: protected pages redirect again.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});
