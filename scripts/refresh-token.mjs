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
const PROXY_URL = process.env.PROXY_URL || undefined;

if (!USERNAME || !PASSWORD) {
  console.error("TRUTHSOCIAL_USERNAME and TRUTHSOCIAL_PASSWORD must be set.");
  process.exit(1);
}

const BASE_URL = "https://truthsocial.com";

async function extractToken() {
  const browser = await chromium.launch({ headless: true });
  const contextOptions = {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };

  if (PROXY_URL) {
    console.error(`[refresh-token] Using proxy: ${PROXY_URL.replace(/:[^:@]+@/, ':***@')}`);
    contextOptions.proxy = { server: PROXY_URL };
  }

  const context = await browser.newContext(contextOptions);

  const page = await context.newPage();

  let token = null;

  // Intercept the OAuth token response
  page.on("response", async (response) => {
    const url = response.url();
    // Match both /oauth/token and /oauth/v2/token
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

    // Wait for page to settle — allow up to 15s for Cloudflare challenge
    console.error("[refresh-token] Waiting for page to settle...");
    await page.waitForTimeout(10000);
    console.error(`[refresh-token] Current URL: ${page.url()}`);

    // Dismiss cookie consent banner if present
    try {
      const acceptCookies = page.locator('#cookiescript_accept, [data-cs-action="accept"], button:has-text("Accept")');
      const cookieBanner = await acceptCookies.first().isVisible();
      if (cookieBanner) {
        console.error("[refresh-token] Dismissing cookie banner...");
        await acceptCookies.first().click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // No cookie banner, continue
    }

    // Click the "Sign In" button to open the login form
    console.error("[refresh-token] Clicking Sign In button...");
    const signInButton = page.locator('button:has-text("Sign In")');
    await signInButton.waitFor({ state: "visible", timeout: 15000 });
    await signInButton.click();

    // Wait for the login form to appear
    await page.waitForTimeout(2000);

    // Now look for the form inputs
    console.error("[refresh-token] Waiting for login form...");
    const emailInput = page.locator('input[type="text"], input[type="email"], input[name="username"], input[placeholder*="email" i], input[placeholder*="username" i]');
    await emailInput.first().waitFor({ state: "visible", timeout: 15000 });

    console.error("[refresh-token] Filling credentials...");
    await emailInput.first().fill(USERNAME);

    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.first().fill(PASSWORD);

    // Submit the form
    console.error("[refresh-token] Submitting login...");
    const submitButton = page.locator('button[type="submit"], form button:has-text("Log"), form button:has-text("Sign")');
    await submitButton.first().click();

    // Wait for the token response
    console.error("[refresh-token] Waiting for auth response...");
    await page.waitForTimeout(10000);

    if (!token) {
      // Try a bit longer
      await page.waitForTimeout(5000);
    }

    if (!token) {
      console.error("[refresh-token] Could not extract token. Final URL:", page.url());
      // Take a screenshot for debugging
      await page.screenshot({ path: "scripts/failed-login.png", fullPage: true });
      console.error("[refresh-token] Screenshot saved to scripts/failed-login.png");
      process.exit(1);
    }

    console.error("[refresh-token] Token extracted successfully.");
    // Output token on stdout (clean, no prefix) for downstream consumption
    console.log(token);
  } finally {
    await browser.close();
  }
}

extractToken().catch((err) => {
  console.error("[refresh-token] Fatal error:", err.message);
  process.exit(1);
});
