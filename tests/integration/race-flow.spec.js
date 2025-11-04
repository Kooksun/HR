import { expect, test } from "@playwright/test";

const HOST_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://127.0.0.1:8080";

test.describe("Host race flow", () => {
  test("host starts countdown and sees results modal after race", async ({ page }) => {
    await page.goto(HOST_URL);

    const playerInput = page.locator("#player-names");
    await expect(playerInput).toBeVisible();

    await playerInput.fill("Kim,Lee,Park");
    await page.getByRole("button", { name: "Start Race" }).click();

    const countdown = page.locator("#countdown");
    await expect(countdown).toBeVisible();
    await expect(countdown.locator(".countdown-value")).toHaveText(/^[543210]$/);

    const tracks = page.locator(".track");
    await expect(tracks).toHaveCount(3);

    const resultsModal = page.locator("#results-modal");
    await expect(resultsModal).toBeVisible({ timeout: 30_000 });
    await expect(resultsModal.locator("ol li")).toHaveCount(3);
  });
});
