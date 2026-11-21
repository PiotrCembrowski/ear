import { expect, test, type Page } from "@playwright/test";

/** Records every stream and constraint the page requests, so tests can check they were released. */
async function instrumentMicrophone(page: Page) {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const w = window as unknown as { __streams: MediaStream[]; __constraints: MediaStreamConstraints[] };
    w.__streams = [];
    w.__constraints = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      w.__constraints.push(constraints ?? {});
      const stream = await original(constraints);
      w.__streams.push(stream);
      return stream;
    };
  });
}

const liveTrackCount = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length,
  );

test.describe("Listen screen (fake microphone playing a synthetic A4)", () => {
  test.beforeEach(async ({ page }) => {
    await instrumentMicrophone(page);
  });

  test("identifies A4 live, shows the result, and releases the microphone on Stop", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    await page.goto("/listen");
    await expect(page.getByText("Microphone off")).toBeVisible();

    await page.getByRole("button", { name: "Start listening" }).click();
    await expect(page.getByText(/^Listening/)).toBeVisible();

    // The live tuner (screen-reader announcement mirrors the visible readout).
    await expect(page.locator("[aria-live=polite]").filter({ hasText: "Detected A4" })).toBeVisible({ timeout: 15_000 });
    // The note's summary appears when the tone ends.
    const card = page.getByRole("region", { name: "Last note" });
    await expect(card.getByText("A4", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("High", { exact: true })).toBeVisible();
    // Through another full loop of the fake mic (silence → tone → silence), the
    // background hiss must never be reported as a sound of its own.
    await page.waitForTimeout(4500);
    await expect(card.getByText("A4", { exact: true })).toBeVisible();
    await expect(card.getByText(/No clear pitch/)).toHaveCount(0);

    // Musical-analysis constraints were requested.
    const constraints = await page.evaluate(() => (window as unknown as { __constraints: MediaStreamConstraints[] }).__constraints[0]);
    expect(constraints?.audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(await liveTrackCount(page)).toBe(1);

    await page.getByRole("button", { name: "Stop listening" }).click();
    await expect(page.getByText("Microphone off")).toBeVisible();
    expect(await liveTrackCount(page)).toBe(0); // the browser's mic indicator turns off
    expect(consoleErrors).toEqual([]);
  });

  test("sends no audio (or anything else) over the network while listening", async ({ page }) => {
    await page.goto("/listen");
    const requests: Array<{ method: string; url: string; bodyBytes: number }> = [];
    page.on("request", (request) => requests.push({ method: request.method(), url: request.url(), bodyBytes: request.postDataBuffer()?.length ?? 0 }));
    const sockets: string[] = [];
    page.on("websocket", (socket) => sockets.push(socket.url()));

    await page.getByRole("button", { name: "Start listening" }).click();
    await expect(page.getByRole("region", { name: "Last note" }).getByText("A4", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Stop listening" }).click();

    // Only static files from this site (the worker script and the worklet) may load.
    for (const request of requests) {
      expect(request.method, request.url).toBe("GET");
      expect(request.bodyBytes, request.url).toBe(0);
      expect(new URL(request.url).origin).toBe(new URL(page.url()).origin);
    }
    expect(sockets).toEqual([]);
  });

  test("turns the microphone off when the tab goes to the background", async ({ page }) => {
    await page.goto("/listen");
    await page.getByRole("button", { name: "Start listening" }).click();
    await expect(page.getByText(/^Listening/)).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByText("Listening paused")).toBeVisible();
    expect(await liveTrackCount(page)).toBe(0);
    await expect(page.getByRole("button", { name: "Start listening again" }).first()).toBeVisible();
  });

  test("can be started from the keyboard", async ({ page }) => {
    await page.goto("/listen");
    await page.getByRole("button", { name: "Start listening" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/^Listening/)).toBeVisible();
    await page.keyboard.press("Enter"); // focus stays on the (now) Stop button
    await expect(page.getByText("Microphone off")).toBeVisible();
  });
});

test.describe("Listen screen errors", () => {
  test("explains a blocked microphone", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    });
    await page.goto("/listen");
    await page.getByRole("button", { name: "Start listening" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Microphone access is blocked" })).toBeVisible();
  });

  test("explains a microphone in use by another app", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Could not start", "NotReadableError"));
    });
    await page.goto("/listen");
    await page.getByRole("button", { name: "Start listening" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "The microphone is busy" })).toBeVisible();
  });
});
