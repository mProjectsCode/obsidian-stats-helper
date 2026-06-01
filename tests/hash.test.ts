import { describe, expect, test } from "bun:test";
import { chunkForPlugin, stableHash } from "../src/hash.ts";

describe("stableHash", () => {
  test("is deterministic", () => {
    expect(stableHash("obsidian-git")).toBe(stableHash("obsidian-git"));
  });

  test("assigns chunks inside the configured range", () => {
    for (const id of ["obsidian-git", "dataview", "calendar", "templater-obsidian"]) {
      const chunk = chunkForPlugin(id, 8);
      expect(chunk).toBeGreaterThanOrEqual(0);
      expect(chunk).toBeLessThan(8);
    }
  });
});

