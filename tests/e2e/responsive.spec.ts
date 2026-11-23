/**
 * Responsive layout beyond the 360 px checks in accessibility.spec.ts:
 * tablet, landscape phone and desktop widths, the navigation switch at the
 * `lg` breakpoint (1024 px), and the result screens (charts are the widest
 * content) on small screens.
 */
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_ID, MEMBER_ID } from "./support/fake-supabase";
import { signInAs } from "./support/session";

const FAKE = "http://127.0.0.1:54399";
const PIANO_A4 = "20000000-0000-4000-8000-000000000001";

const VIEWPORTS = [
  { name: "landscape phone", width: 780, height: 360 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];
const PUBLIC_PAGES = ["/", "/sign-in", "/listen"];
const SIGNED_IN_PAGES = ["/dashboard", "/listen?mode=closest", "/library", "/history", "/settings", "/admin/references", "/admin/import"];

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: page is ${overflow}px wider than the screen`).toBeLessThanOrEqual(0);
}

test.beforeEach(async () => {
  await fetch(`${FAKE}/__reset`, { method: "POST" });
});

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} (${viewport.width}×${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("public pages fit the screen", async ({ page }) => {
      for (const path of PUBLIC_PAGES) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expectNoHorizontalScroll(page, path);
      }
    });

    test("signed-in pages fit the screen", async ({ page, context, baseURL }) => {
      await signInAs(context, ADMIN_ID, baseURL!);
      for (const path of SIGNED_IN_PAGES) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expectNoHorizontalScroll(page, path);
      }
    });
  });
}

test.describe("navigation switches at the lg breakpoint", () => {
  test("below 1024 px: a menu button opens and closes the navigation", async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await signInAs(context, MEMBER_ID, baseURL!);
    await page.goto("/dashboard");
    const toggle = page.getByRole("button", { name: "Open menu" });
    await expect(toggle).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

    await toggle.click();
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Library" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nav).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  });

  test("at 1024 px and wider: the sidebar is always visible", async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await signInAs(context, MEMBER_ID, baseURL!);
    await page.goto("/dashboard");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Library" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
  });
});

test.describe("result screens on small screens", () => {
  for (const width of [360, 768]) {
    test(`compare result with chart fits at ${width} px`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await signInAs(context, MEMBER_ID, baseURL!);
      await page.goto(`/listen?mode=compare&ref=${PIANO_A4}`);
      await page.getByRole("button", { name: "Start listening" }).click();
      const result = page.getByRole("region", { name: "Result" });
      const chart = result.getByRole("img", { name: /Pitch compared with the reference/ });
      await expect(chart).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Stop listening" }).click();

      await expectNoHorizontalScroll(page, `compare result at ${width}px`);
      const chartBox = await chart.boundingBox();
      expect(chartBox, "chart has a size").not.toBeNull();
      expect(chartBox!.x).toBeGreaterThanOrEqual(0);
      expect(chartBox!.x + chartBox!.width).toBeLessThanOrEqual(width);
    });
  }

  test("tuner and Start button are usable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/listen");
    const start = page.getByRole("button", { name: "Start listening" });
    await expect(start).toBeInViewport();
    const box = await start.boundingBox();
    // Comfortable touch target (WCAG 2.5.8 asks for at least 24 px; we aim for 44).
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await start.click();
    await expect(page.getByRole("region", { name: "Last note" }).getByText("A4", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalScroll(page, "tuner with a result at 360px");
    await page.getByRole("button", { name: "Stop listening" }).click();
  });
});
