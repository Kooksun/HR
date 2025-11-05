import { expect, test } from "@playwright/test";

const HOST_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://127.0.0.1:8080";

async function waitForSessionCleared(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () =>
      (window as any).__APP_STATE__?.sessionId == null &&
      Array.isArray((window as any).__APP_STATE__?.players) &&
      (window as any).__APP_STATE__.players.length === 0,
    undefined,
    { timeout: 10_000 }
  );
}

async function startRace(page: import("@playwright/test").Page, names = "Kim,Lee") {
  await page.goto(HOST_URL);
  await page.fill("#player-names", names);
  await page.getByRole("button", { name: "Start Race" }).click();
  await page.waitForSelector("#countdown", { state: "hidden", timeout: 20_000 });
}

async function waitForFinishResult(page: import("@playwright/test").Page) {
  await expect(page.locator("#results-modal"))
    .toBeVisible({ timeout: 20_000 });
}

test.describe("Session lifecycle cleanup", () => {
  test("session removed on results close", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await startRace(page);
    await waitForFinishResult(page);

    await page.click("#results-close");
    await waitForSessionCleared(page);

    await context.close();
  });

  test("session removed on tab unload", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await startRace(page);

    await context.close();

    const checkContext = await browser.newContext();
    const checkPage = await checkContext.newPage();
    await checkPage.goto(HOST_URL);

    await checkPage.waitForTimeout(500);
    const state = await checkPage.evaluate(() => (window as any).__APP_STATE__);
    expect(state.sessionId).toBeNull();

    await checkContext.close();
  });
});
