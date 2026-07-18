import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("health endpoint reports ok shape", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();

    const body = (await response.json()) as {
      ok?: boolean;
      checks?: Record<string, unknown>;
    };

    expect(typeof body.ok).toBe("boolean");
    expect(body.checks).toBeTruthy();
  });

  test("home responds with a document", async ({ page }) => {
    const response = await page.goto("/");
    expect(response).toBeTruthy();
    expect(response!.status()).toBeLessThan(500);

    // Signed-out users land on Clerk sign-in or the app shell after redirect.
    await expect(page.locator("body")).toBeVisible();
  });

  test("invalid share link is unavailable without auth", async ({ request }) => {
    // Short token fails format check before DB — public route, no Clerk.
    const response = await request.get("/s/bad");
    expect(response.status()).toBe(404);
  });
});
