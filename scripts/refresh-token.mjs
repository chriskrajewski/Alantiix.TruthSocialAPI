/**
 * Headless login to Truth Social via Playwright.
 * Extracts the OAuth access_token by intercepting the /oauth/token response.
 *
 * Usage:
 *   node scripts/refresh-token.mjs
 *
 * Requires env vars:
 *   TRUTHSOCIAL_USERNAME
 *   TRUTHSOCIAL_PASSWORD
 *
 * Outputs the token to stdout (last line) for piping into other scripts.
 */

import { chromium } from "playwright";

const USERNAME = process.env.TRUTHSOCIAL_USERNAME;
const PASSWORD = process.env.TRUTHSOCIAL_PASSWORD;

if (!USERNAME || !PASSWORD) {
  console.error("TRUTHSOCIAL_USERNAME and TRUTHSOCIAL_PASSWORD must be set.");
  process.exit(1);
}

const BASE_URL = "https://truthsocial.com";

async function extractToken() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  let token = null;

  // Intercept the OAuth token response
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/oauth") && url.includes("token") && response.status() === 200) {
      try {
        const json = await response.json();
        if (json.access_token) {
          token = json.access_token;
          console.error(`[refresh-token] Token captured from ${url}`);
        }
      } catch {
        // not JSON, ignore
      }
    }
  });

  try {
    console.error("[refresh-token] Navigating to login page...");
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for page to settle (Cloudflare challenge + SPA hydration)
    console.error("[refresh-token] Waiting for page to settle...");
    await page.waitForTimeout(10000);
    console.error(`[refresh-token] Current URL: ${page.url()}`);

    // Dismiss cookie consent banner if present
    try {
      const acceptCookies = page.locator('#cookiescript_accept, [data-cs-action="accept"], button:has-text("Accept")');
      if (await acceptCookies.first().isVisible()) {
        console.error("[refresh-token] Dismissing cookie banner...");
        await acceptCookies.first().click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // No cookie banner, continue
    }

    // Check if login form is already visible or we need to click Sign In
    const emailInput = page.locator('input[type="text"], input[type="email"], input[name="username"], input[placeholder*="email" i], input[placeholder*="username" i]');
    const passwordInput = page.locator('input[type="password"]');
    const signInButton = page.locator('button:has-text("Sign In")');

    const formVisible = await passwordInput.first().isVisible().catch(() => false);

    if (!formVisible) {
      const signInVisible = await signInButton.isVisible().catch(() => false);
      if (signInVisible) {
        console.error("[refresh-token] Clicking Sign In button...");
        await signInButton.click();
        await page.waitForTimeout(2000);
      }
    }

    // Fill login form
    console.error("[refresh-token] Waiting for login form...");
    await emailInput.first().waitFor({ state: "visible", timeout: 15000 });

    console.error("[refresh-token] Filling credentials...");
    await emailInput.first().fill(USERNAME);
    await passwordInput.first().fill(PASSWORD);

    // Submit the form
    console.error("[refresh-token] Submitting login...");
    const submitButton = page.locator('button[type="submit"], form button:has-text("Log"), form button:has-text("Sign")');
    await submitButton.first().click();

    // Wait for the token response
    console.error("[refresh-token] Waiting for auth response...");
    await page.waitForTimeout(10000);

    if (!token) {
      await page.waitForTimeout(5000);
    }

    if (!token) {
      console.error("[refresh-token] Could not extract token. Final URL:", page.url());
      process.exit(1);
    }

    console.error("[refresh-token] Token extracted successfully.");
    console.log(token);
  } finally {
    await browser.close();
  }
}

extractToken().catch((err) => {
  console.error("[refresh-token] Fatal error:", err.message);
  process.exit(1);
});
