import { describe, expect, test } from "bun:test";
import { parseLinkHeader } from "../src/github.ts";
import { parseCommunityPlugins, selectPlugins, simplifyRelease } from "../src/harvester.ts";

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
          attestationBudget: 50,
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
        attestationBudget: 50,
      }),
    ).toEqual([{ id: "two", repo: "a/two", name: "", author: "", description: "" }]);
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
        assets: [{ name: "main.js", size: 123, digest: "sha256:abc" }],
      }),
    ).toEqual({
      tag: "1.2.3",
      name: "Version 1.2.3",
      description: "Notes",
      author: "maintainer",
      publishedAt: "2026-01-01T00:00:00Z",
      prerelease: false,
      draft: false,
      assets: [{ name: "main.js", size: 123, digest: "sha256:abc" }],
      hasReleaseAttestation: null,
      attestationCheckedAt: null,
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
