import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./json.ts";
import type { PluginData } from "./types.ts";

export interface PluginDownloadSummaryEntry {
  repo: string;
  downloads: number;
  releasesWithDownloads: number;
}

export interface PluginDownloadSummary {
  generatedAt: string;
  plugins: Record<string, PluginDownloadSummaryEntry>;
}

const pluginDir = "data/plugins";
export const pluginDownloadSummaryPath = "data/plugin-downloads.json";

export async function writePluginDownloadSummary(generatedAt: string): Promise<PluginDownloadSummary> {
  const summary = await buildPluginDownloadSummary(generatedAt);
  await writeJsonFile(pluginDownloadSummaryPath, summary);
  return summary;
}

export async function buildPluginDownloadSummary(generatedAt: string): Promise<PluginDownloadSummary> {
  const files = (await readdir(join(process.cwd(), pluginDir))).filter((name) => name.endsWith(".json"));
  const plugins: Record<string, PluginDownloadSummaryEntry> = {};

  for (const file of files) {
    const plugin = await readJsonFile<PluginData | null>(join(pluginDir, file), null);
    if (!plugin) {
      continue;
    }

    const entry = summarizePluginDownloads(plugin);
    if (entry.releasesWithDownloads > 0) {
      plugins[plugin.id] = entry;
    }
  }

  return {
    generatedAt,
    plugins,
  };
}

export function summarizePluginDownloads(plugin: PluginData): PluginDownloadSummaryEntry {
  let downloads = 0;
  let releasesWithDownloads = 0;

  for (const release of plugin.releases) {
    if (release.draft) {
      continue;
    }

    const manifestAssets = release.assets.filter(
      (asset) => asset.name === "manifest.json" && Number.isFinite(asset.downloadCount),
    );
    if (manifestAssets.length === 0) {
      continue;
    }

    downloads += manifestAssets.reduce((total, asset) => total + asset.downloadCount, 0);
    releasesWithDownloads += 1;
  }

  return {
    repo: plugin.repo,
    downloads,
    releasesWithDownloads,
  };
}
