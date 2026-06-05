import "server-only";
import type { SessionOptions } from "node-tls-client";
import { ClientIdentifier, Session, initTLS } from "node-tls-client";
import { TruthApiError } from "./errors";

const BASE_URL = "https://truthsocial.com";
const API_BASE_URL = `${BASE_URL}/api`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0";
const CLIENT_ID = "9X1Fdd-pxNsAgEDNi_SfhJWi8T-vLuV2WVzKIbkTCw4";
const CLIENT_SECRET = "ozF8jzI4968oTKFkEnsBC-UbLPCdrSv0MkXGQu2o_-M";

const MAX_RATE_LIMIT_RETRIES = 2;

const DEFAULT_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Sec-CH-UA":
    '"Chromium";v="131", "Not;A=Brand";v="24", "Google Chrome";v="131"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"macOS"',
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`,
  "User-Agent": USER_AGENT
} as const;

const PROXY_URL =
  process.env.http_proxy ??
  process.env.https_proxy ??
  process.env.HTTP_PROXY ??
  process.env.HTTPS_PROXY ??
  undefined;

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

let tlsSessionPromise: Promise<Session> | null = null;

async function getTlsSession(): Promise<Session> {
  if (!tlsSessionPromise) {
    tlsSessionPromise = (async () => {
      await initTLS();
      const options: SessionOptions = {
        clientIdentifier: ClientIdentifier.chrome_131,
        timeout: 30000
      };
      if (PROXY_URL) {
        options.proxy = PROXY_URL;
      }
      return new Session(options);
    })().catch((error) => {
      tlsSessionPromise = null;
      throw error;
    });
  }

  return await tlsSessionPromise;
}

function sanitizeBody(body: string, maxLength = 400) {
  if (!body) {
    return "";
  }
  const text = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function normalizeHeaders(
  headers:
    | Record<string, string | string[] | undefined>
    | undefined
): HeaderMap {
  const map: HeaderMap = {};

  if (!headers) {
    return map;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (!key) {
      continue;
    }
    const normalizedKey = key.toLowerCase();
    if (Array.isArray(value)) {
      if (value.length > 0) {
        map[normalizedKey] = value.join(", ");
      }
    } else if (typeof value === "string") {
      map[normalizedKey] = value;
    }
  }

  return map;
}

class TruthSocialClient {
  private token: string | null;
  private tokenPromise: Promise<string> | null = null;
  private rateLimit: RateLimitInfo = {};

  constructor() {
    this.token = process.env.TRUTHSOCIAL_TOKEN ?? null;
  }

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
    if (top < 1) {
      return [];
    }

    const results: unknown[] = [];
    for await (const page of this.paginated(
      `/v1/statuses/${postId}/favourited_by`,
      { limit: 80 }
    )) {
      for (const user of page as unknown[]) {
        results.push(user);
        if (!includeAll && results.length >= top) {
          return results;
        }
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
    if (top < 1) {
      return [];
    }

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
          if (!includeAll && results.length >= top) {
            return results;
          }
        }
      }
    }

    return results;
  }

  lookup(acct: string) {
    return this.get("/v1/accounts/lookup", {
      searchParams: { acct }
    });
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

      if (!response || this.isEmptyResult(response)) {
        break;
      }

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
    return this.get(`/v1/truth/trending/truths`, {
      searchParams: { limit }
    });
  }

  groupPosts(groupId: string, limit = 20) {
    return this.paginatedCollect(`/v1/timelines/group/${groupId}`, limit);
  }

  tags() {
    return this.get("/v1/trends");
  }

  suggested(maximum = 50) {
    return this.get("/v2/suggestions", {
      searchParams: { limit: maximum }
    });
  }

  trendingGroups(limit = 10) {
    return this.get("/v1/truth/trends/groups", {
      searchParams: { limit }
    });
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
    return this.get("/v3/truth/ads", {
      searchParams: { device }
    });
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

    const sinceDate = createdAfter
      ? new Date(createdAfter)
      : undefined;

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

      if (!posts.length) {
        break;
      }

      for (const post of posts) {
        post._pulled = new Date().toISOString();
        const createdAt = new Date(post.created_at);
        if (sinceDate && createdAt <= sinceDate) {
          return results;
        }
        if (sinceComparable && BigInt(post.id) <= sinceComparable) {
          return results;
        }

        results.push(post);
      }

      const nextId = posts.at(-1)?.id;
      if (!nextId) {
        break;
      }

      if (lastId === nextId) {
        break;
      }

      lastId = nextId;

      searchParams = {
        ...searchParams,
        max_id: nextId
      };
    }

    return results;
  }

  private extractId(post: string) {
    return post.split("/").pop() ?? post;
  }

  private isEmptyResult(response: unknown) {
    if (!response || typeof response !== "object") {
      return true;
    }
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
        if (maximum && output.length >= maximum) {
          return output;
        }
      }
    }
    return output;
  }

  private async paginatedCollect(path: string, limit: number) {
    const collected: unknown[] = [];
    let total = 0;
    for await (const page of this.paginated(path)) {
      const items = (page as unknown[]) ?? [];
      if (!items.length) {
        break;
      }
      collected.push(...items);
      total += items.length;
      if (total >= limit) {
        break;
      }
    }

    return collected.slice(0, limit);
  }

  private async *paginated(
    path: string,
    params?: Record<string, string | number | boolean>,
    resume?: string
  ) {
    let nextUrl: URL | null = new URL(`${API_BASE_URL}${path}`);
    const searchParams = new URLSearchParams();

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        searchParams.set(key, String(value));
      }
    }

    if (resume) {
      searchParams.set("max_id", resume);
    }

    nextUrl.search = searchParams.toString();

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
    const url = new URL(`${API_BASE_URL}${path}`);
    if (options.searchParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.searchParams)) {
        if (value !== undefined) {
          params.set(key, String(value));
        }
      }
      url.search = params.toString();
    }

    const response = await this.request(url, { signal: options.signal });
    return options.raw ? response : response.body;
  }

  private async request(
    url: URL,
    options: { signal?: AbortSignal } = {},
    attempt = 0
  ): Promise<{ body: any; next: URL | null }> {
    const token = await this.ensureToken();
    const session = await getTlsSession();
    const headers = {
      ...DEFAULT_HEADERS,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };

    let response;
    try {
      response = await session.get(url.toString(), {
        headers,
        followRedirects: true
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown network error.";
      throw new TruthApiError(
        `Failed to reach Truth Social API: ${message}`,
        502
      );
    }

    const headerMap = normalizeHeaders(response.headers);
    this.captureRateLimit(headerMap);

    if (response.status === 401) {
      this.invalidateToken();
      const retryToken = await this.ensureToken();
      if (retryToken === token) {
        throw new TruthApiError(
          "Authentication failed: check Truth Social credentials.",
          401
        );
      }
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new TruthApiError(
          "Authentication failed after retrying with refreshed credentials.",
          401
        );
      }
      return this.request(url, options, attempt + 1);
    }

    const shouldRetry = await this.handleRateLimiting(
      response.status,
      headerMap,
      attempt
    );
    if (shouldRetry) {
      return this.request(url, options, attempt + 1);
    }

    if (response.status >= 400) {
      const sanitized = sanitizeBody(response.body);
      const suffix = sanitized ? `: ${sanitized}` : "";
      throw new TruthApiError(
        `Truth Social API request failed (${response.status})${suffix}`,
        response.status
      );
    }

    let data;
    try {
      data = JSON.parse(response.body);
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
    if (!linkHeader) {
      return null;
    }
    const links = linkHeader.split(",");
    for (const link of links) {
      const [urlPart, relPart] = link.split(";");
      if (relPart && relPart.includes('rel="next"')) {
        const cleaned = urlPart.trim().replace(/^<|>$/g, "");
        try {
          return new URL(cleaned);
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

    if (!Number.isNaN(remaining) && remaining !== undefined && remaining <= 50) {
      const waitMs = this.computeResetDelay(headers["x-ratelimit-reset"]);
      await this.delay(waitMs);
    }

    if (status !== 429) {
      return false;
    }

    if (attempt >= MAX_RATE_LIMIT_RETRIES) {
      return false;
    }

    const retryDelay = Math.max(
      this.parseRetryAfter(headers["retry-after"]),
      this.computeResetDelay(headers["x-ratelimit-reset"]),
      5000
    );

    await this.delay(retryDelay);
    return true;
  }

  private parseRetryAfter(header?: string): number {
    if (!header) {
      return 0;
    }

    const numeric = Number(header);
    if (!Number.isNaN(numeric) && numeric >= 0) {
      return numeric * 1000;
    }

    const date = new Date(header);
    if (!Number.isNaN(date.getTime())) {
      return date.getTime() - Date.now();
    }

    return 0;
  }

  private computeResetDelay(header?: string): number {
    if (!header) {
      return 0;
    }

    const numeric = Number(header);
    if (!Number.isNaN(numeric)) {
      if (numeric > 1e12) {
        // Likely milliseconds since epoch
        return numeric - Date.now();
      }
      if (numeric > 1e8) {
        // Likely seconds since epoch
        return numeric * 1000 - Date.now();
      }
      if (numeric >= 0) {
        // Treat as relative seconds
        return numeric * 1000;
      }
    }

    const date = new Date(header);
    if (!Number.isNaN(date.getTime())) {
      return date.getTime() - Date.now();
    }

    return 0;
  }

  private async delay(ms: number) {
    const clamped = Math.min(Math.max(ms, 0), 120000);
    if (clamped <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, clamped));
  }

  private invalidateToken() {
    this.token = null;
    this.tokenPromise = null;
  }

  private async ensureToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }
    if (this.tokenPromise) {
      return this.tokenPromise;
    }

    const username = process.env.TRUTHSOCIAL_USERNAME;
    const password = process.env.TRUTHSOCIAL_PASSWORD;

    if (!username || !password) {
      throw new TruthApiError(
        "Truth Social credentials not configured. Set TRUTHSOCIAL_TOKEN or TRUTHSOCIAL_USERNAME/TRUTHSOCIAL_PASSWORD.",
        401
      );
    }

    this.tokenPromise = this.login(username, password)
      .then((newToken) => {
        this.token = newToken;
        return newToken;
      })
      .finally(() => {
        this.tokenPromise = null;
      });

    return this.tokenPromise;
  }

  private async login(username: string, password: string) {
    const session = await getTlsSession();
    let response;
    try {
      response = await session.post(`${BASE_URL}/oauth/token`, {
        headers: {
          ...DEFAULT_HEADERS,
          "Content-Type": "application/json",
          Origin: BASE_URL,
          Referer: `${BASE_URL}/`
        },
        followRedirects: true,
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "password",
          username,
          password,
          redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
          scope: "read"
        })
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown network error.";
      throw new TruthApiError(
        `Failed to reach Truth Social login endpoint: ${message}`,
        502
      );
    }

    const headers = normalizeHeaders(response.headers);
    this.captureRateLimit(headers);

    if (response.status >= 400) {
      const sanitized = sanitizeBody(response.body);
      const suffix = sanitized ? `: ${sanitized}` : "";
      throw new TruthApiError(
        `Failed to authenticate with Truth Social (${response.status})${suffix}`,
        response.status
      );
    }

    console.log("[TruthSocial Auth] Response status:", response.status);
    console.log("[TruthSocial Auth] Response headers:", JSON.stringify(headers, null, 2));
    console.log("[TruthSocial Auth] Response body (first 500 chars):", typeof response.body === "string" ? response.body.slice(0, 500) : response.body);

    let payload: any;
    try {
      payload = JSON.parse(response.body);
    } catch (parseError) {
      console.error("[TruthSocial Auth] JSON parse failed:", parseError instanceof Error ? parseError.message : parseError);
      console.error("[TruthSocial Auth] Raw body type:", typeof response.body);
      throw new TruthApiError(
        "Truth Social authentication response missing token.",
        502
      );
    }

    console.log("[TruthSocial Auth] Parsed payload keys:", Object.keys(payload));

    if (!payload.access_token) {
      console.error("[TruthSocial Auth] No access_token in payload. Full payload:", JSON.stringify(payload, null, 2));
      throw new TruthApiError(
        "Truth Social authentication response missing token.",
        502
      );
    }

    return payload.access_token as string;
  }
}

export const truthClient = new TruthSocialClient();
