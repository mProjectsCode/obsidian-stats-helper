import { describe, expect, test } from "bun:test";
import { summarizePluginDownloads } from "../src/downloadSummary.ts";
import { parseLinkHeader } from "../src/github.ts";
import {
  fetchReleases,
  normalizeDailyState,
  parseCommunityPlugins,
  selectPlugins,
  simplifyRelease,
} from "../src/harvester.ts";
import { buildStatusMarkdown } from "../src/status.ts";

describe("parseCommunityPlugins", () => {
  test("keeps required fields and defaults optional strings", () => {
    expect(parseCommunityPlugins([{ id: "x", repo: "owner/repo" }])).toEqual([
      { id: "x", repo: "owner/repo", name: "", author: "", description: "" },
    ]);
  });
});

describe("selectPlugins", () => {
  test("daily mode resumes from the cursor", () => {
    const plugins = parseCommunityPlugins([
      { id: "one", repo: "a/one" },
      { id: "two", repo: "a/two" },
      { id: "three", repo: "a/three" },
    ]);

    expect(
      selectPlugins(
        plugins,
        {
          mode: "daily",
          chunkCount: 8,
          dryRun: true,
          maxRuntimeMinutes: 25,
          rateLimitFloor: 100,
        },
        {
          day: "2026-06-01",
          cursorIndex: 1,
          completed: false,
          pluginCount: 3,
          startedAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ),
    ).toEqual([
      { id: "two", repo: "a/two", name: "", author: "", description: "" },
      { id: "three", repo: "a/three", name: "", author: "", description: "" },
    ]);
  });

  test("can select an explicit plugin id", () => {
    const plugins = parseCommunityPlugins([
      { id: "one", repo: "a/one" },
      { id: "two", repo: "a/two" },
    ]);

    expect(
      selectPlugins(plugins, {
        mode: "chunk",
        pluginId: "two",
        chunkIndex: 0,
        chunkCount: 8,
        dryRun: true,
        maxRuntimeMinutes: 25,
        rateLimitFloor: 100,
      }),
    ).toEqual([{ id: "two", repo: "a/two", name: "", author: "", description: "" }]);
  });
});

describe("normalizeDailyState", () => {
  const fallback = {
    day: "2026-06-02",
    cursorIndex: 0,
    completed: false,
    pluginCount: 3,
    startedAt: "2026-06-02T00:00:00Z",
    updatedAt: "2026-06-02T00:00:00Z",
  };

  test("keeps an in-progress cursor across calendar days", () => {
    expect(
      normalizeDailyState(
        {
          day: "2026-06-01",
          cursorIndex: 2,
          completed: false,
          pluginCount: 3,
          startedAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T23:00:00Z",
        },
        fallback,
        3,
      ),
    ).toEqual({
      day: "2026-06-01",
      cursorIndex: 2,
      completed: false,
      pluginCount: 3,
      startedAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T23:00:00Z",
    });
  });

  test("chills after the current day's pass completed", () => {
    expect(
      normalizeDailyState(
        {
          day: "2026-06-02",
          cursorIndex: 3,
          completed: true,
          pluginCount: 3,
          startedAt: "2026-06-02T00:00:00Z",
          updatedAt: "2026-06-02T23:00:00Z",
        },
        fallback,
        3,
      ),
    ).toEqual({
      day: "2026-06-02",
      cursorIndex: 3,
      completed: true,
      pluginCount: 3,
      startedAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T23:00:00Z",
    });
  });

  test("starts a new pass after a previous day's pass completed", () => {
    expect(
      normalizeDailyState(
        {
          day: "2026-06-01",
          cursorIndex: 3,
          completed: true,
          pluginCount: 3,
          startedAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T23:00:00Z",
        },
        fallback,
        3,
      ),
    ).toEqual(fallback);
  });
});

describe("simplifyRelease", () => {
  test("extracts the committed release fields", () => {
    expect(
      simplifyRelease({
        tag_name: "1.2.3",
        name: "Version 1.2.3",
        body: "Notes",
        author: { login: "maintainer" },
        published_at: "2026-01-01T00:00:00Z",
        prerelease: false,
        draft: false,
        assets: [
          { name: "main.js", size: 123, download_count: 12, digest: "sha256:abc" },
          { name: "manifest.json", size: 456, download_count: 3 },
        ],
      }),
    ).toEqual({
      tag: "1.2.3",
      name: "Version 1.2.3",
      description: "Notes",
      author: "maintainer",
      publishedAt: "2026-01-01T00:00:00Z",
      prerelease: false,
      draft: false,
      downloadCount: 3,
      assets: [
        { name: "main.js", size: 123, downloadCount: 12, digest: "sha256:abc" },
        { name: "manifest.json", size: 456, downloadCount: 3 },
      ],
    });
  });
});

describe("fetchReleases", () => {
  test("bypasses conditional caching so download counts refresh", async () => {
    const calls: Array<{ pathOrUrl: string; conditional?: boolean }> = [];
    const github = {
      async request<T>(pathOrUrl: string, options?: RequestInit & { conditional?: boolean }) {
        calls.push({ pathOrUrl, conditional: options?.conditional });

        return {
          status: 200,
          notModified: false,
          headers: new Headers(),
          rateLimit: { limit: 5000, remaining: 4999, reset: 0 },
          data: [
            {
              tag_name: "1.0.0",
              name: "1.0.0",
              body: null,
              author: null,
              published_at: "2026-01-01T00:00:00Z",
              prerelease: false,
              draft: false,
              assets: [{ name: "manifest.json", size: 100, download_count: 42 }],
            },
          ] as T,
        };
      },
    };

    const result = await fetchReleases(github, "owner", "repo", [
      {
        tag: "1.0.0",
        name: "1.0.0",
        description: null,
        author: null,
        publishedAt: "2026-01-01T00:00:00Z",
        prerelease: false,
        draft: false,
        downloadCount: 1,
        assets: [{ name: "manifest.json", size: 100, downloadCount: 1 }],
      },
    ]);

    expect(calls).toEqual([{ pathOrUrl: "/repos/owner/repo/releases?per_page=100", conditional: false }]);
    expect(result.releases[0]?.downloadCount).toBe(42);
  });
});

describe("summarizePluginDownloads", () => {
  test("sums manifest.json downloads from non-draft releases", () => {
    expect(
      summarizePluginDownloads({
        id: "plugin",
        name: "Plugin",
        author: "Author",
        description: "Description",
        repo: "owner/repo",
        presentInCommunityList: true,
        removedAt: null,
        defaultBranch: "main",
        manifest: null,
        releases: [
          {
            tag: "1.0.0",
            name: "1.0.0",
            description: null,
            author: null,
            publishedAt: "2026-01-01T00:00:00Z",
            prerelease: false,
            draft: false,
            downloadCount: 10,
            assets: [
              { name: "main.js", size: 100, downloadCount: 10 },
              { name: "manifest.json", size: 10, downloadCount: 7 },
            ],
          },
          {
            tag: "1.1.0-beta",
            name: "1.1.0-beta",
            description: null,
            author: null,
            publishedAt: "2026-01-02T00:00:00Z",
            prerelease: true,
            draft: false,
            downloadCount: 3,
            assets: [
              { name: "main.js", size: 100, downloadCount: 3 },
              { name: "manifest.json", size: 10, downloadCount: 2 },
            ],
          },
          {
            tag: "1.2.0",
            name: "1.2.0",
            description: null,
            author: null,
            publishedAt: "2026-01-03T00:00:00Z",
            prerelease: false,
            draft: true,
            downloadCount: 100,
            assets: [{ name: "manifest.json", size: 10, downloadCount: 100 }],
          },
        ],
        lastFetchedAt: "2026-01-04T00:00:00Z",
        lastChangedAt: "2026-01-04T00:00:00Z",
        errors: [],
      }),
    ).toEqual({
      repo: "owner/repo",
      downloads: 9,
      releasesWithDownloads: 2,
    });
  });
});

describe("parseLinkHeader", () => {
  test("extracts relation URLs", () => {
    const links = parseLinkHeader('<https://api.github.com/repos/a/b/releases?page=2>; rel="next", <x>; rel="last"');
    expect(links.next).toBe("https://api.github.com/repos/a/b/releases?page=2");
    expect(links.last).toBe("x");
  });
});

describe("buildStatusMarkdown", () => {
  test("summarizes the current harvest state", () => {
    expect(
      buildStatusMarkdown({
        index: {
          generatedAt: "2026-06-01T12:00:00.000Z",
          plugins: [{ presentInCommunityList: true }, { presentInCommunityList: false }],
        },
        state: {
          completed: false,
          cursorIndex: 1,
          day: null,
          pluginCount: 4,
          startedAt: null,
          updatedAt: "2026-06-01T12:30:00.000Z",
          requestStats: {
            total: 9,
            fetched: 6,
            notModified: 2,
            failed: 1,
            conditional: 5,
            unconditional: 4,
          },
        },
        cacheStats: {
          total: 12,
          repo: 4,
          manifest: 5,
          releases: 2,
          other: 1,
        },
        pluginStats: {
          files: 2,
          withReleases: 2,
          withAnyDownloadStats: 1,
          missingDownloadStats: 1,
          releases: 3,
          releasesWithDownloadStats: 2,
          assets: 5,
          assetsWithDownloadStats: 4,
          totalManifestDownloads: 123,
          oldestFetchedAt: "2026-06-01T12:00:00.000Z",
          newestFetchedAt: "2026-06-01T12:30:00.000Z",
        },
        downloadSummaryStats: {
          generatedAt: "2026-06-01T12:30:00.000Z",
          plugins: 1,
          totalDownloads: 123,
        },
      }),
    ).toBe(`# Status

- Last harvest update: 2026-06-01T12:30:00.000Z
- Current pass: in progress (1/4, 25.0%)
- Indexed plugins: 2 (1 present, 1 removed)
- Plugin detail files: 2
- Plugin fetch window: 2026-06-01T12:00:00.000Z to 2026-06-01T12:30:00.000Z
- Plugins with releases: 2
- Plugins with download stats: 1/2 (50.0%)
- Plugins missing download stats: 1
- Releases with download stats: 2/3 (66.7%)
- Assets with download stats: 4/5 (80.0%)
- Total manifest.json downloads: 123
- Download summary: 1 plugins, 123 downloads, generated at 2026-06-01T12:30:00.000Z
- HTTP cache entries: 12 (4 repo, 5 manifest, 2 releases, 1 other)
- Last run API requests: 9 total (6 fetched, 2 cached 304, 1 failed)
- Last run request modes: 5 conditional, 4 unconditional
`);
  });
});
