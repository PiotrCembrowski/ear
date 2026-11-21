import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_ID, MEMBER_ID } from "./support/fake-supabase";
import { signInAs } from "./support/session";

const FAKE = "http://127.0.0.1:54399";
const generated = (dir: string) => readdirSync(path.resolve("tests/e2e/.generated", dir)).map((f) => path.resolve("tests/e2e/.generated", dir, f));

async function fillImportSettings(page: Page) {
  await page.getByLabel("Variant").fill("salamander");
  await page.getByLabel("License").fill("CC-BY-3.0");
  await page.getByLabel("Attribution").fill("Test attribution");
}

test.describe("library", () => {
  test("is only for signed-in users", async ({ page }) => {
    await page.goto("/library");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Flibrary/);
  });

  test("shows references with provenance, previews, and a visible synthetic label", async ({ page, context, baseURL }) => {
    await signInAs(context, MEMBER_ID, baseURL!);
    await page.goto("/library");
    await expect(page.getByText("2 sounds in the library.")).toBeVisible();
    const synthetic = page.getByRole("article", { name: "Test tone 440 Hz" });
    await expect(synthetic.getByText("Synthetic test tone")).toBeVisible();
    await expect(synthetic.getByLabel("Preview Test tone 440 Hz")).toBeVisible();
    await expect(page.getByRole("article", { name: /Piano A4/ }).getByText("License: CC-BY-3.0")).toBeVisible();
    // Members don't see the admin entry.
    await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Admin" })).toHaveCount(0);
  });
});

test.describe("admin", () => {
  test.beforeEach(async () => {
    await fetch(`${FAKE}/__reset`, { method: "POST" });
  });

  test("is hidden from, and refused to, non-admins", async ({ page, context, baseURL }) => {
    await signInAs(context, MEMBER_ID, baseURL!);
    await page.goto("/admin/import");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("previews a bulk import with every file status and the coverage report", async ({ page, context, baseURL }) => {
    await signInAs(context, ADMIN_ID, baseURL!);
    await page.goto("/admin/import");
    await fillImportSettings(page);
    await expect(page.getByText(/1 note is already stored for “salamander”/)).toBeVisible();
    await page.locator("input[type=file]").setInputFiles(generated("import"));
    await expect(page.getByRole("button", { name: "Import 2 files" })).toBeEnabled({ timeout: 20_000 });

    const status = (file: string) => page.getByRole("row").filter({ hasText: file });
    await expect(status("060_C4_v80.wav")).toContainText("Ready");
    await expect(status("069_A4_v80.wav")).toContainText("already in the library");
    await expect(status("Bb4-v80.wav")).toContainText("Another file in this batch");
    await expect(status("C9.wav")).toContainText("outside the piano's range");
    await expect(status("kick.wav")).toContainText("No note found");
    await expect(status("notes.txt")).toContainText("Unsupported format");
    await expect(status("D5.mp3")).toContainText("Decode failure");
    await expect(page.getByText("Partial set")).toBeVisible();
    await expect(page.getByText(/3 of 88 piano notes/)).toBeVisible();
  });

  test("imports files end to end: upload, server analysis, rows and features", async ({ page, context, baseURL }) => {
    await signInAs(context, ADMIN_ID, baseURL!);
    await page.goto("/admin/import");
    await fillImportSettings(page);
    await page.locator("input[type=file]").setInputFiles(generated("import"));
    await page.getByRole("button", { name: "Import 2 files" }).click({ timeout: 20_000 });
    await expect(page.getByText("Import finished")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("2 imported.")).toBeVisible();

    const log = (await (await fetch(`${FAKE}/__log`)).json()) as string[];
    expect(log.filter((l) => l.startsWith("upload "))).toEqual(["upload piano/salamander/060_C4_v80.wav", "upload piano/salamander/070_As4_v80.wav"]);
    expect(log.filter((l) => l.startsWith("upsert reference_features"))).toEqual([
      "upsert reference_features pitch@1.0.0,timbre@1.0.0",
      "upsert reference_features pitch@1.0.0,timbre@1.0.0",
    ]);
    const inserted = log.find((l) => l.startsWith("insert reference_sounds"))!;
    expect(inserted).toContain('"license":"CC-BY-3.0"');
    expect(inserted).toContain('"is_synthetic":false');
    expect(inserted).toContain('"sample_rate":44100');
  });

  test("flags a sample whose pitch doesn't match its file name", async ({ page, context, baseURL }) => {
    await signInAs(context, ADMIN_ID, baseURL!);
    await page.goto("/admin/import");
    await fillImportSettings(page);
    await page.locator("input[type=file]").setInputFiles(generated("mislabelled"));
    await page.getByRole("button", { name: "Import 1 file" }).click({ timeout: 20_000 });
    await expect(page.getByText(/Sounds like C4 .*check the file name/)).toBeVisible({ timeout: 30_000 });
  });

  test("validates the license and source before importing", async ({ page, context, baseURL }) => {
    await signInAs(context, ADMIN_ID, baseURL!);
    await page.goto("/admin/import");
    await page.getByLabel("Variant").fill("salamander");
    await page.locator("input[type=file]").setInputFiles(generated("import"));
    await page.getByRole("button", { name: "Import 2 files" }).click({ timeout: 20_000 });
    await expect(page.getByText("Enter the license")).toBeVisible();
    await expect(page.getByText("Add a source link or an attribution")).toBeVisible();
    const log = (await (await fetch(`${FAKE}/__log`)).json()) as string[];
    expect(log).toEqual([]); // nothing was uploaded
  });
});
