import "server-only";
import { TruthApiError } from "./errors";

const BASE_URL = "https://truthsocial.com";
const API_BASE_URL = `${BASE_URL}/api`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_RATE_LIMIT_RETRIES = 2;

type TruthRequestOptions = {
  searchParams?: Record<string, string | number | boolean | undefined>;
  raw?: boolean;
  signal?: AbortSignal;
};

type RateLimitInfo = {
  limit?: number;
  remaining?: number;
  resetAt?: Date;
};

type HeaderMap = Record<string, string>;

type BrowserSession = {
  page: any;
  context: any;
  browser: any;
  token: string;
};

let sessionPromise: Promise<BrowserSession> | null = null;

async function getBrowserSession(): Promise<BrowserSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ userAgent: USER_AGENT });
      const page = await context.newPage();

      // Navigate to Truth Social to establish Cloudflare clearance
      console.log("[TruthClient] Launching browser session...");
      await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
      await page.waitForTimeout(3000);

      // Dismiss cookie banner if present
      try {
        const acceptCookies = page.locator(
          '#cookiescript_accept, [data-cs-action="accept"], button:has-text("Accept")'
        );
        if (await acceptCookies.first().isVisible()) {
          await acceptCookies.first().click();
          await page.waitForTimeout(1000);
        }
      } catch {
        // no banner
      }

      // Authenticate
      const token = await authenticate(page, context);
      console.log("[TruthClient] Browser session ready.");

      return { page, context, browser, token };
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }

  return sessionPromise;
}

async function authenticate(
  page: any,
  context: any
): Promise<string> {
  // If we have a pre-set token, just use it
  const existingToken = process.env.TRUTHSOCIAL_TOKEN;
  if (existingToken) {
    console.log("[TruthClient] Using existing TRUTHSOCIAL_TOKEN.");
    return existingToken;
  }

  const username = process.env.TRUTHSOCIAL_USERNAME;
  const password = process.env.TRUTHSOCIAL_PASSWORD;

  if (!username || !password) {
    throw new TruthApiError(
      "Truth Social credentials not configured. Set TRUTHSOCIAL_TOKEN or TRUTHSOCIAL_USERNAME/TRUTHSOCIAL_PASSWORD.",
      401
    );
  }

  let token: string | null = null;

  // Listen for the OAuth token response
  page.on("response", async (response: any) => {
    const url: string = response.url();
    if (
      url.includes("/oauth") &&
      url.includes("token") &&
      response.status() === 200
    ) {
      try {
        const json = await response.json();
        if (json.access_token) {
          token = json.access_token;
        }
      } catch {
        // ignore
      }
    }
  });

  // Click Sign In
  const signInButton = page.locator('button:has-text("Sign In")');
  await signInButton.waitFor({ state: "visible", timeout: 15000 });
  await signInButton.click();
  await page.waitForTimeout(2000);

  // Fill login form
  const emailInput = page.locator(
    'input[type="text"], input[type="email"], input[name="username"], input[placeholder*="email" i], input[placeholder*="username" i]'
  );
  await emailInput.first().waitFor({ state: "visible", timeout: 15000 });
  await emailInput.first().fill(username);

  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.first().fill(password);

  // Submit
  const submitButton = page.locator(
    'button[type="submit"], form button:has-text("Log"), form button:has-text("Sign")'
  );
  await submitButton.first().click();

  // Wait for token
  await page.waitForTimeout(10000);

  if (!token) {
    throw new TruthApiError(
      "Failed to authenticate with Truth Social: no token received.",
      401
    );
  }

  return token;
}

function normalizeHeaders(
  headers: Record<string, string> | undefined
): HeaderMap {
  const map: HeaderMap = {};
  if (!headers) return map;
  for (const [key, value] of Object.entries(headers)) {
    if (key && typeof value === "string") {
      map[key.toLowerCase()] = value;
    }
  }
  return map;
}

function sanitizeBody(body: string, maxLength = 400) {
  if (!body) return "";
  const text = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

class TruthSocialClient {
  private rateLimit: RateLimitInfo = {};

  getRateLimit(): RateLimitInfo {
    return { ...this.rateLimit };
  }

  async userLikes(
    post: string,
    opts: { includeAll?: boolean; top?: number }
  ): Promise<unknown[]> {
    const postId = this.extractId(post);
    const includeAll = opts.includeAll ?? false;
    const top = opts.top ?? 40;
    if (top < 1) return [];

    const results: unknown[] = [];
    for await (const page of this.paginated(
      `/v1/statuses/${postId}/favourited_by`,
      { limit: 80 }
    )) {
      for (const user of page as unknown[]) {
        results.push(user);
        if (!includeAll && results.length >= top) return results;
      }
    }
    return results;
  }

  async pullComments(
    post: string,
    opts: { includeAll?: boolean; onlyFirst?: boolean; top?: number }
  ): Promise<unknown[]> {
    const postId = this.extractId(post);
    const includeAll = opts.includeAll ?? false;
    const onlyFirst = opts.onlyFirst ?? false;
    const top = opts.top ?? 40;
    if (top < 1) return [];

    const results: unknown[] = [];
    for await (const page of this.paginated(
      `/v1/statuses/${postId}/context/descendants`,
      { sort: "oldest" }
    )) {
      for (const item of page as Array<Record<string, unknown>>) {
        if (
          (onlyFirst && item["in_reply_to_id"] === postId) ||
          !onlyFirst
        ) {
          results.push(item);
          if (!includeAll && results.length >= top) return results;
        }
      }
    }
    return results;
  }

  lookup(acct: string) {
    return this.get("/v1/accounts/lookup", { searchParams: { acct } });
  }

  async search(params: {
    type: string;
    query: string;
    limit?: number;
    resolve?: boolean | number;
    offset?: number;
    minId?: string;
    maxId?: string;
  }) {
    const {
      type,
      query,
      limit = 40,
      resolve = true,
      offset = 0,
      minId = "0",
      maxId
    } = params;

    const collected: unknown[] = [];
    let currentOffset = offset;

    while (collected.length < limit) {
      const response = await this.get("/v2/search", {
        searchParams: {
          q: query,
          type,
          resolve: Number(resolve),
          limit: Math.min(40, limit - collected.length),
          offset: currentOffset,
          min_id: minId,
          ...(maxId ? { max_id: maxId } : {})
        }
      });

      if (!response || this.isEmptyResult(response)) break;
      collected.push(response);
      currentOffset += 40;
    }

    return collected;
  }

  hashtag(tag: string, limit = 100) {
    const sanitizedTag = tag.startsWith("#") ? tag.slice(1) : tag;
    return this.paginatedCollect(`/v1/timelines/tag/${sanitizedTag}`, limit);
  }

  trending(limit = 10) {
    return this.get(`/v1/truth/trending/truths`, { searchParams: { limit } });
  }

  groupPosts(groupId: string, limit = 20) {
    return this.paginatedCollect(`/v1/timelines/group/${groupId}`, limit);
  }

  tags() {
    return this.get("/v1/trends");
  }

  suggested(maximum = 50) {
    return this.get("/v2/suggestions", { searchParams: { limit: maximum } });
  }

  trendingGroups(limit = 10) {
    return this.get("/v1/truth/trends/groups", { searchParams: { limit } });
  }

  groupTags() {
    return this.get("/v1/groups/tags");
  }

  suggestedGroups(maximum = 50) {
    return this.get("/v1/truth/suggestions/groups", {
      searchParams: { limit: maximum }
    });
  }

  ads(device = "desktop") {
    return this.get("/v3/truth/ads", { searchParams: { device } });
  }

  async userFollowers(opts: {
    userHandle?: string;
    userId?: string;
    maximum?: number;
    resume?: string;
  }) {
    const { userHandle, userId, maximum = 1000, resume } = opts;
    const resolvedId =
      userId ?? ((await this.lookupRequired(userHandle)) as any).id;
    return this.collectLimited(
      `/v1/accounts/${resolvedId}/followers`,
      maximum,
      resume
    );
  }

  async userFollowing(opts: {
    userHandle?: string;
    userId?: string;
    maximum?: number;
    resume?: string;
  }) {
    const { userHandle, userId, maximum = 1000, resume } = opts;
    const resolvedId =
      userId ?? ((await this.lookupRequired(userHandle)) as any).id;
    return this.collectLimited(
      `/v1/accounts/${resolvedId}/following`,
      maximum,
      resume
    );
  }

  async pullStatuses(opts: {
    username: string;
    replies?: boolean;
    verbose?: boolean;
    createdAfter?: string;
    sinceId?: string;
    pinned?: boolean;
  }) {
    const {
      username,
      replies = false,
      createdAfter,
      sinceId,
      pinned = false
    } = opts;
    const user = await this.lookupRequired(username);
    const userId = user.id;
    const params: Record<string, string> = {};

    if (pinned) {
      params.pinned = "true";
      params.with_muted = "true";
    } else if (!replies) {
      params.exclude_replies = "true";
    }

    const sinceDate = createdAfter ? new Date(createdAfter) : undefined;
    const results: Array<Record<string, any>> = [];
    const sinceComparable = sinceId ? BigInt(sinceId) : undefined;

    let searchParams = { ...params };
    let lastId: string | undefined;

    while (true) {
      const { body } = (await this.get(`/v1/accounts/${userId}/statuses`, {
        searchParams,
        raw: true
      })) as { body: Array<Record<string, any>> };

      const posts = [...(body ?? [])].sort((a, b) =>
        BigInt(a.id) > BigInt(b.id) ? -1 : 1
      );

      if (!posts.length) break;

      for (const post of posts) {
        post._pulled = new Date().toISOString();
        const createdAt = new Date(post.created_at);
        if (sinceDate && createdAt <= sinceDate) return results;
        if (sinceComparable && BigInt(post.id) <= sinceComparable)
          return results;
        results.push(post);
      }

      const nextId = posts.at(-1)?.id;
      if (!nextId) break;
      if (lastId === nextId) break;
      lastId = nextId;
      searchParams = { ...searchParams, max_id: nextId };
    }

    return results;
  }

  private extractId(post: string) {
    return post.split("/").pop() ?? post;
  }

  private isEmptyResult(response: unknown) {
    if (!response || typeof response !== "object") return true;
    return Object.values(response).every(
      (value) =>
        value === null ||
        value === undefined ||
        (Array.isArray(value) && value.length === 0)
    );
  }

  private async lookupRequired(acct?: string) {
    if (!acct) {
      throw new TruthApiError(
        "userHandle is required when userId is not provided.",
        400
      );
    }
    const user = await this.lookup(acct);
    if (!user || (user as any).error) {
      throw new TruthApiError(`Unable to lookup user ${acct}`, 404);
    }
    return user as Record<string, any>;
  }

  private async collectLimited(
    path: string,
    maximum: number,
    resume?: string
  ) {
    const output: unknown[] = [];
    for await (const page of this.paginated(path, {}, resume)) {
      for (const entry of page as unknown[]) {
        output.push(entry);
        if (maximum && output.length >= maximum) return output;
      }
    }
    return output;
  }

  private async paginatedCollect(path: string, limit: number) {
    const collected: unknown[] = [];
    let total = 0;
    for await (const page of this.paginated(path)) {
      const items = (page as unknown[]) ?? [];
      if (!items.length) break;
      collected.push(...items);
      total += items.length;
      if (total >= limit) break;
    }
    return collected.slice(0, limit);
  }

  private async *paginated(
    path: string,
    params?: Record<string, string | number | boolean>,
    resume?: string
  ) {
    let nextUrl: string | null = `${API_BASE_URL}${path}`;
    const searchParams = new URLSearchParams();

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        searchParams.set(key, String(value));
      }
    }
    if (resume) {
      searchParams.set("max_id", resume);
    }

    const qs = searchParams.toString();
    if (qs) nextUrl += `?${qs}`;

    while (nextUrl) {
      const response = await this.request(nextUrl);
      yield response.body;
      nextUrl = response.next;
    }
  }

  private async get(
    path: string,
    options: TruthRequestOptions = {}
  ): Promise<unknown> {
    let url = `${API_BASE_URL}${path}`;
    if (options.searchParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.searchParams)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const response = await this.request(url);
    return options.raw ? response : response.body;
  }

  private async request(
    url: string,
    attempt = 0
  ): Promise<{ body: any; next: string | null }> {
    const session = await getBrowserSession();

    // Execute fetch inside the browser page context to leverage Cloudflare clearance
    const result = await session.page.evaluate(
      async ({ url, token }: { url: string; token: string }) => {
        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json, text/plain, */*"
          }
        });

        const headers: Record<string, string> = {};
        resp.headers.forEach((value: string, key: string) => {
          headers[key.toLowerCase()] = value;
        });

        const body = await resp.text();
        return { status: resp.status, headers, body };
      },
      { url, token: session.token }
    );

    const headerMap = result.headers as HeaderMap;
    this.captureRateLimit(headerMap);

    // Handle 401 - token expired
    if (result.status === 401) {
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new TruthApiError(
          "Authentication failed: check Truth Social credentials.",
          401
        );
      }
      // Reset session to re-authenticate
      sessionPromise = null;
      return this.request(url, attempt + 1);
    }

    // Handle rate limiting
    const shouldRetry = await this.handleRateLimiting(
      result.status,
      headerMap,
      attempt
    );
    if (shouldRetry) {
      return this.request(url, attempt + 1);
    }

    if (result.status >= 400) {
      const sanitized = sanitizeBody(result.body);
      const suffix = sanitized ? `: ${sanitized}` : "";
      throw new TruthApiError(
        `Truth Social API request failed (${result.status})${suffix}`,
        result.status
      );
    }

    let data;
    try {
      data = JSON.parse(result.body);
    } catch {
      throw new TruthApiError(
        "Failed to decode JSON response from Truth Social.",
        502
      );
    }

    const next = this.parseNextLink(headerMap["link"]);
    return { body: data, next };
  }

  private parseNextLink(linkHeader: string | undefined | null) {
    if (!linkHeader) return null;
    const links = linkHeader.split(",");
    for (const link of links) {
      const [urlPart, relPart] = link.split(";");
      if (relPart && relPart.includes('rel="next"')) {
        const cleaned = urlPart.trim().replace(/^<|>$/g, "");
        try {
          new URL(cleaned);
          return cleaned;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  private captureRateLimit(headers: HeaderMap) {
    const limit = headers["x-ratelimit-limit"];
    const remaining = headers["x-ratelimit-remaining"];
    const reset = headers["x-ratelimit-reset"];

    this.rateLimit = {
      limit: limit ? Number(limit) : undefined,
      remaining: remaining ? Number(remaining) : undefined,
      resetAt: reset ? new Date(reset) : undefined
    };
  }

  private async handleRateLimiting(
    status: number,
    headers: HeaderMap,
    attempt: number
  ): Promise<boolean> {
    const remainingRaw = headers["x-ratelimit-remaining"];
    const remaining = remainingRaw ? Number(remainingRaw) : undefined;

    if (
      !Number.isNaN(remaining) &&
      remaining !== undefined &&
      remaining <= 50
    ) {
      const waitMs = this.computeResetDelay(headers["x-ratelimit-reset"]);
      await this.delay(waitMs);
    }

    if (status !== 429) return false;
    if (attempt >= MAX_RATE_LIMIT_RETRIES) return false;

    const retryDelay = Math.max(
      this.parseRetryAfter(headers["retry-after"]),
      this.computeResetDelay(headers["x-ratelimit-reset"]),
      5000
    );

    await this.delay(retryDelay);
    return true;
  }

  private parseRetryAfter(header?: string): number {
    if (!header) return 0;
    const numeric = Number(header);
    if (!Number.isNaN(numeric) && numeric >= 0) return numeric * 1000;
    const date = new Date(header);
    if (!Number.isNaN(date.getTime())) return date.getTime() - Date.now();
    return 0;
  }

  private computeResetDelay(header?: string): number {
    if (!header) return 0;
    const numeric = Number(header);
    if (!Number.isNaN(numeric)) {
      if (numeric > 1e12) return numeric - Date.now();
      if (numeric > 1e8) return numeric * 1000 - Date.now();
      if (numeric >= 0) return numeric * 1000;
    }
    const date = new Date(header);
    if (!Number.isNaN(date.getTime())) return date.getTime() - Date.now();
    return 0;
  }

  private async delay(ms: number) {
    const clamped = Math.min(Math.max(ms, 0), 120000);
    if (clamped <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, clamped));
  }
}

export const truthClient = new TruthSocialClient();
