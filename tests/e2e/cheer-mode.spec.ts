import { expect, test } from "@playwright/test";

const HOST_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://127.0.0.1:8080";

test.describe("Spectator cheer mode (pre-implementation)", () => {
  test("spectator cheer buttons boost the selected player within two ticks", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await hostPage.goto(HOST_URL);

    await hostPage.fill("#player-names", "Kim,Lee");
    await hostPage.getByRole("button", { name: "Start Race" }).click();
    await hostPage.waitForTimeout(500);

    const spectatorPage = await hostContext.newPage();
    await spectatorPage.goto(`${HOST_URL}?mode=spectator`);

    await spectatorPage.waitForFunction(
      () => window.__APP_STATE__ && window.__APP_STATE__.mode === 'spectator',
      undefined,
      { timeout: 5_000 },
    );

    await expect(spectatorPage.locator("[data-role='spectator-controls']")).toBeVisible();
    const cheerButton = spectatorPage.locator("[data-role='cheer-button'][data-player-id='kim']");

    await hostPage.waitForSelector("#countdown", { state: "hidden", timeout: 20_000 });

    await cheerButton.click();
    await cheerButton.click();
    await cheerButton.click();

    await hostPage.waitForFunction(
      () =>
        Array.isArray(window.__APP_STATE__?.players) &&
        window.__APP_STATE__.players.some((player) => (player.cheerCount ?? 0) > 0),
      undefined,
      { timeout: 7_000 },
    );

    await spectatorPage.close();
    await hostContext.close();
  });
});
