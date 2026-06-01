import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarvestRunState, HttpCacheFile } from "./types.ts";

interface StatusIndexPlugin {
  presentInCommunityList?: boolean;
}

interface StatusIndex {
  generatedAt: string | null;
  plugins: StatusIndexPlugin[];
}

export interface StatusInputs {
  index: StatusIndex;
  state: HarvestRunState;
  cachedRequests: number;
  pluginFiles: number;
}

const indexPath = "data/index.json";
const harvestRunPath = "data/state/harvest-run.json";
const httpCachePath = "data/state/http-cache.json";
const pluginDir = "data/plugins";
const statusPath = "STATUS.md";

const fallbackIndex: StatusIndex = {
  generatedAt: null,
  plugins: [],
};

export async function writeStatusMarkdown(): Promise<void> {
  const index = await readJsonFile<StatusIndex>(indexPath, fallbackIndex);
  const state = await readJsonFile<HarvestRunState>(harvestRunPath, {
    completed: false,
    cursorIndex: 0,
    day: null,
    pluginCount: index.plugins.length,
    startedAt: null,
    updatedAt: null,
  });
  const cache = await readJsonFile<HttpCacheFile>(httpCachePath, { entries: {} });
  const files = await readPluginFiles();

  await writeFile(
    statusPath,
    buildStatusMarkdown({
      index,
      state,
      cachedRequests: Object.keys(cache.entries).length,
      pluginFiles: files.length,
    }),
  );
}

export function buildStatusMarkdown(inputs: StatusInputs): string {
  const pluginCount = Number.isInteger(inputs.state.pluginCount) && inputs.state.pluginCount > 0
    ? inputs.state.pluginCount
    : inputs.index.plugins.length;
  const cursorIndex = Math.min(Math.max(inputs.state.cursorIndex, 0), pluginCount);
  const presentCount = inputs.index.plugins.filter((plugin) => plugin.presentInCommunityList !== false).length;
  const removedCount = inputs.index.plugins.length - presentCount;

  return [
    "# Status",
    "",
    `- Last harvest update: ${inputs.state.updatedAt ?? inputs.index.generatedAt ?? "unknown"}`,
    `- Current pass: ${inputs.state.completed ? "complete" : "in progress"} (${cursorIndex}/${pluginCount}, ${formatPercent(cursorIndex, pluginCount)})`,
    `- Indexed plugins: ${inputs.index.plugins.length} (${presentCount} present, ${removedCount} removed)`,
    `- Plugin detail files: ${inputs.pluginFiles}`,
    `- HTTP cache entries: ${inputs.cachedRequests}`,
    "",
  ].join("\n");
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function readPluginFiles(): Promise<string[]> {
  try {
    return (await readdir(join(process.cwd(), pluginDir))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

function formatPercent(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return "0.0%";
  }

  return `${((value / total) * 100).toFixed(1)}%`;
}

if (import.meta.main) {
  await writeStatusMarkdown();
}
