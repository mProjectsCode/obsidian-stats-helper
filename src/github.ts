import type { GitHubRequestStats, HttpCacheFile, RateLimit } from "./types.ts";

export interface GitHubResponse<T> {
  status: number;
  data: T | null;
  notModified: boolean;
  headers: Headers;
  rateLimit: RateLimit;
}

export interface GitHubClientOptions {
  token?: string;
  apiVersion?: string;
  userAgent?: string;
  cache: HttpCacheFile;
}

export class GitHubHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, message: string, body: string) {
    super(message);
    this.name = "GitHubHttpError";
    this.status = status;
    this.body = body;
  }
}

export interface GitHubRequestInit extends RequestInit {
  conditional?: boolean;
}

export class GitHubClient {
  private readonly token?: string;
  private readonly apiVersion: string;
  private readonly userAgent: string;
  private readonly cache: HttpCacheFile;
  readonly stats: GitHubRequestStats = {
    total: 0,
    fetched: 0,
    notModified: 0,
    failed: 0,
    conditional: 0,
    unconditional: 0,
  };

  constructor(options: GitHubClientOptions) {
    this.token = options.token;
    this.apiVersion = options.apiVersion ?? "2022-11-28";
    this.userAgent = options.userAgent ?? "obsidian-stats-helper";
    this.cache = options.cache;
  }

  async request<T>(pathOrUrl: string, options: GitHubRequestInit = {}): Promise<GitHubResponse<T>> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `https://api.github.com${pathOrUrl}`;
    const method = (options.method ?? "GET").toUpperCase();
    const cacheKey = `${method} ${url}`;
    const cached = this.cache.entries[cacheKey];
    const headers = new Headers(options.headers);
    const conditional = options.conditional !== false;

    headers.set("Accept", headers.get("Accept") ?? "application/vnd.github+json");
    headers.set("User-Agent", this.userAgent);

    if (url.startsWith("https://api.github.com/")) {
      headers.set("X-GitHub-Api-Version", this.apiVersion);
    }

    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }

    if (conditional && method === "GET" && cached?.etag) {
      headers.set("If-None-Match", cached.etag);
    }

    if (conditional && method === "GET" && cached?.lastModified) {
      headers.set("If-Modified-Since", cached.lastModified);
    }

    const { conditional: _conditional, ...fetchOptions } = options;
    this.stats.total += 1;
    if (conditional) {
      this.stats.conditional += 1;
    } else {
      this.stats.unconditional += 1;
    }

    let response: Response;
    try {
      response = await fetch(url, { ...fetchOptions, method, headers });
    } catch (error) {
      this.stats.failed += 1;
      throw error;
    }

    const rateLimit = readRateLimit(response.headers);

    if (response.status === 304) {
      this.stats.notModified += 1;
      return { status: response.status, data: null, notModified: true, headers: response.headers, rateLimit };
    }

    if (!response.ok) {
      this.stats.failed += 1;
      const body = await response.text();
      throw new GitHubHttpError(response.status, `GitHub request failed with ${response.status} for ${url}`, body);
    }

    this.stats.fetched += 1;

    if (conditional && method === "GET") {
      const etag = response.headers.get("etag") ?? undefined;
      const lastModified = response.headers.get("last-modified") ?? undefined;

      if (etag || lastModified) {
        this.cache.entries[cacheKey] = { etag, lastModified };
      }
    }

    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
      ? ((await response.json()) as T)
      : ((await response.text()) as T);

    return { status: response.status, data, notModified: false, headers: response.headers, rateLimit };
  }
}

export async function fetchCommunityPlugins(): Promise<unknown> {
  const response = await fetch(
    "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json",
    {
      headers: {
        "User-Agent": "obsidian-stats-helper",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch community plugin list: ${response.status}`);
  }

  return response.json();
}

export function parseLinkHeader(header: string | null): Record<string, string> {
  const links: Record<string, string> = {};

  if (!header) {
    return links;
  }

  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      links[match[2]] = match[1];
    }
  }

  return links;
}

function readRateLimit(headers: Headers): RateLimit {
  return {
    limit: parseNullableInt(headers.get("x-ratelimit-limit")),
    remaining: parseNullableInt(headers.get("x-ratelimit-remaining")),
    reset: parseNullableInt(headers.get("x-ratelimit-reset")),
  };
}

function parseNullableInt(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
