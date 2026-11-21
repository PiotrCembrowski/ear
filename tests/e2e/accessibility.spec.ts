/**
 * Automated accessibility (axe-core, WCAG 2.2 A/AA rules) and phone-width
 * layout checks on every page. Automated checks find roughly a third of
 * accessibility problems; docs/MANUAL-TEST-CHECKLIST.md covers the rest.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_ID, MEMBER_ID } from "./support/fake-supabase";
import { signInAs } from "./support/session";

const PUBLIC_PAGES = ["/", "/sign-in", "/sign-up", "/reset-password", "/listen"];
const MEMBER_PAGES = ["/dashboard", "/listen?mode=compare&ref=20000000-0000-4000-8000-000000000001", "/listen?mode=closest", "/library", "/history", "/settings"];
const ADMIN_PAGES = ["/admin/references", "/admin/references/new", "/admin/import"];

async function audit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  expect(summary, `${path}`).toEqual([]);
}

async function noHorizontalScroll(page: Page, path: string) {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `${path} at 360px`).toBe(false);
}

test.describe("accessibility and layout: public pages", () => {
  for (const path of PUBLIC_PAGES) {
    test(`axe: ${path}`, async ({ page }) => audit(page, path));
    test(`360px: ${path}`, async ({ page }) => noHorizontalScroll(page, path));
  }
});

test.describe("accessibility and layout: signed-in pages", () => {
  test.beforeEach(async ({ context, baseURL }) => signInAs(context, MEMBER_ID, baseURL!));
  for (const path of MEMBER_PAGES) {
    test(`axe: ${path}`, async ({ page }) => audit(page, path));
    test(`360px: ${path}`, async ({ page }) => noHorizontalScroll(page, path));
  }
});

test.describe("accessibility and layout: admin pages", () => {
  test.beforeEach(async ({ context, baseURL }) => signInAs(context, ADMIN_ID, baseURL!));
  for (const path of ADMIN_PAGES) {
    test(`axe: ${path}`, async ({ page }) => audit(page, path));
    test(`360px: ${path}`, async ({ page }) => noHorizontalScroll(page, path));
  }
});

test("axe: Listen screen while listening, with a result", async ({ page }) => {
  await page.goto("/listen");
  await page.getByRole("button", { name: "Start listening" }).click();
  await expect(page.getByRole("region", { name: "Last note" }).getByText("A4", { exact: true })).toBeVisible({ timeout: 20_000 });
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
});
