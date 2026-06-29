import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginDownloadSummary } from "./downloadSummary.ts";
import type { GitHubRequestStats, HarvestRunState, HttpCacheFile } from "./types.ts";

interface StatusIndexPlugin {
  presentInCommunityList?: boolean;
}

interface StatusIndex {
  generatedAt: string | null;
  plugins: StatusIndexPlugin[];
}

export interface StatusInputs {
  index: StatusIndex;
  state: HarvestRunState | null;
  cacheStats: CacheStats;
  pluginStats: PluginStats;
  downloadSummaryStats: DownloadSummaryStats;
}

interface CacheStats {
  total: number | null;
  repo: number;
  manifest: number;
  releases: number;
  other: number;
}

interface PluginStats {
  files: number;
  withReleases: number;
  withAnyDownloadStats: number;
  missingDownloadStats: number;
  releases: number;
  releasesWithDownloadStats: number;
  assets: number;
  assetsWithDownloadStats: number;
  totalManifestDownloads: number;
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
}

interface DownloadSummaryStats {
  generatedAt: string | null;
  plugins: number | null;
  totalDownloads: number | null;
}

const indexPath = "data/index.json";
const pluginDownloadSummaryPath = "data/plugin-downloads.json";
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
  const state = await readOptionalJsonFile<HarvestRunState>(harvestRunPath);
  const cache = await readOptionalJsonFile<HttpCacheFile>(httpCachePath);
  const pluginStats = await readPluginStats();
  const downloadSummary = await readOptionalJsonFile<PluginDownloadSummary>(pluginDownloadSummaryPath);

  await writeFile(
    statusPath,
    buildStatusMarkdown({
      index,
      state,
      cacheStats: summarizeCache(cache),
      pluginStats,
      downloadSummaryStats: summarizeDownloadSummary(downloadSummary),
    }),
  );
}

export function buildStatusMarkdown(inputs: StatusInputs): string {
  const presentCount = inputs.index.plugins.filter((plugin) => plugin.presentInCommunityList !== false).length;
  const removedCount = inputs.index.plugins.length - presentCount;
  const requestStats = inputs.state?.requestStats;

  return [
    "# Status",
    "",
    `- Last harvest update: ${inputs.state?.updatedAt ?? inputs.index.generatedAt ?? "unknown"}`,
    `- Current pass: ${formatCurrentPass(inputs.state, inputs.index.plugins.length)}`,
    `- Indexed plugins: ${inputs.index.plugins.length} (${presentCount} present, ${removedCount} removed)`,
    `- Plugin detail files: ${inputs.pluginStats.files}`,
    `- Plugin fetch window: ${formatRange(inputs.pluginStats.oldestFetchedAt, inputs.pluginStats.newestFetchedAt)}`,
    `- Plugins with releases: ${inputs.pluginStats.withReleases}`,
    `- Plugins with download stats: ${inputs.pluginStats.withAnyDownloadStats}/${inputs.pluginStats.files} (${formatPercent(inputs.pluginStats.withAnyDownloadStats, inputs.pluginStats.files)})`,
    `- Plugins missing download stats: ${inputs.pluginStats.missingDownloadStats}`,
    `- Releases with download stats: ${inputs.pluginStats.releasesWithDownloadStats}/${inputs.pluginStats.releases} (${formatPercent(inputs.pluginStats.releasesWithDownloadStats, inputs.pluginStats.releases)})`,
    `- Assets with download stats: ${inputs.pluginStats.assetsWithDownloadStats}/${inputs.pluginStats.assets} (${formatPercent(inputs.pluginStats.assetsWithDownloadStats, inputs.pluginStats.assets)})`,
    `- Total manifest.json downloads: ${inputs.pluginStats.totalManifestDownloads}`,
    `- Download summary: ${formatDownloadSummaryStats(inputs.downloadSummaryStats)}`,
    `- HTTP cache entries: ${formatCacheStats(inputs.cacheStats)}`,
    `- Last run API requests: ${formatRequestStats(requestStats)}`,
    `- Last run request modes: ${formatRequestModes(requestStats)}`,
    "",
  ].join("\n");
}

function summarizeDownloadSummary(summary: PluginDownloadSummary | null): DownloadSummaryStats {
  if (!summary) {
    return {
      generatedAt: null,
      plugins: null,
      totalDownloads: null,
    };
  }

  const entries = Object.values(summary.plugins);

  return {
    generatedAt: summary.generatedAt,
    plugins: entries.length,
    totalDownloads: entries.reduce((total, entry) => total + entry.downloads, 0),
  };
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function readOptionalJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readPluginStats(): Promise<PluginStats> {
  const stats: PluginStats = {
    files: 0,
    withReleases: 0,
    withAnyDownloadStats: 0,
    missingDownloadStats: 0,
    releases: 0,
    releasesWithDownloadStats: 0,
    assets: 0,
    assetsWithDownloadStats: 0,
    totalManifestDownloads: 0,
    oldestFetchedAt: null,
    newestFetchedAt: null,
  };

  let files: string[];
  try {
    files = (await readdir(join(process.cwd(), pluginDir))).filter((name) => name.endsWith(".json"));
  } catch {
    return stats;
  }

  for (const file of files) {
    const plugin = await readJsonFile<Record<string, unknown> | null>(join(pluginDir, file), null);
    if (!plugin) {
      continue;
    }

    stats.files += 1;
    updateFetchWindow(stats, plugin.lastFetchedAt);

    const releases = Array.isArray(plugin.releases) ? plugin.releases : [];
    if (releases.length > 0) {
      stats.withReleases += 1;
    }

    let pluginHasDownloadStats = false;

    for (const release of releases) {
      if (!release || typeof release !== "object") {
        continue;
      }

      const releaseRecord = release as Record<string, unknown>;
      stats.releases += 1;

      if (isFiniteNumber(releaseRecord.downloadCount)) {
        stats.releasesWithDownloadStats += 1;
        pluginHasDownloadStats = true;
      }

      const assets = Array.isArray(releaseRecord.assets) ? releaseRecord.assets : [];
      for (const asset of assets) {
        if (!asset || typeof asset !== "object") {
          continue;
        }

        stats.assets += 1;
        const assetRecord = asset as Record<string, unknown>;
        if (isFiniteNumber(assetRecord.downloadCount)) {
          stats.assetsWithDownloadStats += 1;
          pluginHasDownloadStats = true;
          if (assetRecord.name === "manifest.json") {
            stats.totalManifestDownloads += assetRecord.downloadCount;
          }
        }
      }
    }

    if (pluginHasDownloadStats) {
      stats.withAnyDownloadStats += 1;
    }
  }

  stats.missingDownloadStats = stats.files - stats.withAnyDownloadStats;
  return stats;
}

function summarizeCache(cache: HttpCacheFile | null): CacheStats {
  const stats: CacheStats = {
    total: cache ? 0 : null,
    repo: 0,
    manifest: 0,
    releases: 0,
    other: 0,
  };

  if (!cache) {
    return stats;
  }

  for (const key of Object.keys(cache.entries)) {
    stats.total = (stats.total ?? 0) + 1;

    if (/^GET https:\/\/api\.github\.com\/repos\/[^/]+\/[^/?]+$/.test(key)) {
      stats.repo += 1;
    } else if (key.includes("/contents/manifest.json")) {
      stats.manifest += 1;
    } else if (key.includes("/releases?")) {
      stats.releases += 1;
    } else {
      stats.other += 1;
    }
  }

  return stats;
}

function updateFetchWindow(stats: PluginStats, value: unknown): void {
  if (typeof value !== "string" || value.length === 0) {
    return;
  }

  if (!stats.oldestFetchedAt || value < stats.oldestFetchedAt) {
    stats.oldestFetchedAt = value;
  }

  if (!stats.newestFetchedAt || value > stats.newestFetchedAt) {
    stats.newestFetchedAt = value;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatPercent(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return "0.0%";
  }

  return `${((value / total) * 100).toFixed(1)}%`;
}

function formatRange(start: string | null, end: string | null): string {
  if (!start && !end) {
    return "unknown";
  }

  return `${start ?? "unknown"} to ${end ?? "unknown"}`;
}

function formatCurrentPass(state: HarvestRunState | null, fallbackPluginCount: number): string {
  if (!state) {
    return "unknown (data/state/harvest-run.json not present)";
  }

  const pluginCount = Number.isInteger(state.pluginCount) && state.pluginCount > 0
    ? state.pluginCount
    : fallbackPluginCount;
  const cursorIndex = Math.min(Math.max(state.cursorIndex, 0), pluginCount);

  return `${state.completed ? "complete" : "in progress"} (${cursorIndex}/${pluginCount}, ${formatPercent(cursorIndex, pluginCount)})`;
}

function formatCacheStats(stats: CacheStats): string {
  if (stats.total === null) {
    return "unavailable (data/state/http-cache.json not present)";
  }

  return `${stats.total} (${stats.repo} repo, ${stats.manifest} manifest, ${stats.releases} releases, ${stats.other} other)`;
}

function formatDownloadSummaryStats(stats: DownloadSummaryStats): string {
  if (stats.plugins === null || stats.totalDownloads === null) {
    return "missing";
  }

  return `${stats.plugins} plugins, ${stats.totalDownloads} downloads, generated at ${stats.generatedAt ?? "unknown"}`;
}

function formatRequestStats(stats: GitHubRequestStats | undefined): string {
  if (!stats) {
    return "unknown";
  }

  return `${stats.total} total (${stats.fetched} fetched, ${stats.notModified} cached 304, ${stats.failed} failed)`;
}

function formatRequestModes(stats: GitHubRequestStats | undefined): string {
  if (!stats) {
    return "unknown";
  }

  return `${stats.conditional} conditional, ${stats.unconditional} unconditional`;
}

if (import.meta.main) {
  await writeStatusMarkdown();
}
