/**
 * Compare, closest match and history, end to end in Chromium:
 *   fake microphone (synthetic A4) → worklet → worker (engine) → result in the
 *   browser → POST /api/comparisons → history pages.
 * Reference features come from tests/e2e/support/fake-supabase.ts, which
 * computes them with the real engine from SYNTHETIC piano notes.
 */
import { expect, test, type Request } from "@playwright/test";
import { MEMBER_ID } from "./support/fake-supabase";
import { signInAs } from "./support/session";

const FAKE = "http://127.0.0.1:54399";
const PIANO_A4 = "20000000-0000-4000-8000-000000000001";
const PIANO = "10000000-0000-4000-8000-000000000001";

test.beforeEach(async () => {
  await fetch(`${FAKE}/__reset`, { method: "POST" });
});

test("compares live sound with a reference, saves a summary (no audio), and shows it in history", async ({ page, context, baseURL }) => {
  await signInAs(context, MEMBER_ID, baseURL!);
  const saves: Request[] = [];
  page.on("request", (r) => r.url().endsWith("/api/comparisons") && saves.push(r));

  // From the library card…
  await page.goto("/library");
  await page.getByRole("link", { name: "Compare with Piano A4 · salamander · v80" }).click();
  await expect(page).toHaveURL(new RegExp(`/listen\\?mode=compare&ref=${PIANO_A4}`));
  await expect(page.getByRole("tab", { name: "Compare" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Compared by pitch")).toBeVisible();

  // …play the (fake-microphone) A4.
  await page.getByRole("button", { name: "Start listening" }).click();
  const result = page.getByRole("region", { name: "Result" });
  await expect(result.getByText("Heuristic similarity score", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(result.getByText("Very close")).toBeVisible();
  await expect(result.getByText("How to read this score")).toBeVisible();
  await expect(result.getByRole("img", { name: /Pitch compared with the reference/ })).toBeVisible();
  await expect(result.getByText(/Saved to your/)).toBeVisible({ timeout: 10_000 });

  // The saved request is a small JSON summary: no audio.
  expect(saves.length).toBeGreaterThanOrEqual(1);
  const body = saves[0]!.postData() ?? "";
  expect(saves[0]!.headers()["content-type"]).toContain("application/json");
  expect(body.length).toBeLessThan(16_000);
  const payload = JSON.parse(body) as { mode: string; referenceId: string; result: { score: number }; userId?: string };
  expect(payload).toMatchObject({ mode: "compare", referenceId: PIANO_A4 });
  expect(payload.userId).toBeUndefined();
  const log = (await (await fetch(`${FAKE}/__log`)).json()) as string[];
  expect(log.find((l) => l.startsWith("insert comparisons"))).toContain(`user=${MEMBER_ID}`);

  // History list and detail.
  await page.getByRole("button", { name: "Stop listening" }).click();
  await page.goto("/history");
  await page.getByRole("link", { name: /vs Piano A4 · salamander · v80/ }).first().click();
  await expect(page.getByText("Heuristic similarity score", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Compare again" })).toBeVisible();
});

test("ranks the closest instrument samples", async ({ page, context, baseURL }) => {
  await signInAs(context, MEMBER_ID, baseURL!);
  await page.goto(`/listen?mode=closest&instrument=${PIANO}`);
  await expect(page.getByText("3 samples ready")).toBeVisible();
  await page.getByRole("button", { name: "Start listening" }).click();
  const matches = page.getByRole("list", { name: "Top matches" });
  await expect(matches).toBeVisible({ timeout: 20_000 });
  await expect(matches.getByRole("listitem").first()).toContainText("A4");
  await expect(page.getByText("Compared with 3 samples.")).toBeVisible();
  await expect(page.getByText(/Saved to your/)).toBeVisible({ timeout: 10_000 });
  const log = (await (await fetch(`${FAKE}/__log`)).json()) as string[];
  expect(log.some((l) => l.startsWith("insert comparisons closest"))).toBe(true);
});

test("saves an identified note on request", async ({ page, context, baseURL }) => {
  await signInAs(context, MEMBER_ID, baseURL!);
  await page.goto("/listen");
  await page.getByRole("button", { name: "Start listening" }).click();
  await page.getByRole("button", { name: "Save this note to history" }).click({ timeout: 20_000 });
  await expect(page.getByText(/Saved to your/)).toBeVisible();
  const log = (await (await fetch(`${FAKE}/__log`)).json()) as string[];
  expect(log.some((l) => l.startsWith("insert comparisons identify"))).toBe(true);
});

test("signed-out visitors can identify notes but are asked to sign in to compare", async ({ page }) => {
  await page.goto("/listen");
  await page.getByRole("tab", { name: "Compare" }).click();
  await expect(page.getByText(/Comparing uses the reference library/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).last()).toHaveAttribute("href", /\/sign-in\?next=/);
  await expect(page).toHaveURL(/mode=compare/);
});

test("the mode tabs work with the keyboard", async ({ page }) => {
  await page.goto("/listen");
  await page.getByRole("tab", { name: "Identify note" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Compare" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Compare" })).toBeFocused();
});
