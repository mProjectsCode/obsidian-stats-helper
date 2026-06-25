import { mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { GitHubClient, GitHubHttpError, fetchCommunityPlugins, parseLinkHeader } from "./github.ts";
import type { GitHubResponse } from "./github.ts";
import { chunkForPlugin } from "./hash.ts";
import { readJsonFile, stableStringify, writeJsonFile } from "./json.ts";
import { writePluginDownloadSummary } from "./downloadSummary.ts";
import type {
  CommunityPlugin,
  HarvestError,
  HarvestOptions,
  HarvestRunState,
  HttpCacheFile,
  PluginData,
  ReleaseSummary,
} from "./types.ts";

const httpCachePath = "data/state/http-cache.json";
const harvestRunPath = "data/state/harvest-run.json";

interface GitHubRepo {
  default_branch: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  author: { login?: string } | null;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
  assets: Array<{
    name: string;
    size: number;
    download_count: number;
    digest?: string | null;
  }>;
}

interface HarvestPluginResult {
  data: PluginData;
  rateLimitRemaining: number | null;
}

interface GitHubRequester {
  request<T>(pathOrUrl: string, options?: RequestInit & { conditional?: boolean }): Promise<GitHubResponse<T>>;
}

interface IndexPluginSummary {
  id: string;
  repo: string;
  chunk: number;
  lastFetchedAt: string | null;
  presentInCommunityList: boolean;
  removedAt: string | null;
}

export async function runHarvest(options: HarvestOptions): Promise<void> {
  validateOptions(options);

  const fetchedAt = new Date().toISOString();
  const day = formatLocalDay(new Date());
  const httpCache = await readJsonFile<HttpCacheFile>(httpCachePath, { entries: {} });
  const github = new GitHubClient({
    token: process.env.GITHUB_TOKEN,
    cache: httpCache,
  });

  const allPlugins = parseCommunityPlugins(await fetchCommunityPlugins());
  const useDailyState = options.mode === "daily" && !options.pluginId;
  const dailyState = useDailyState ? await readDailyState(fetchedAt, day, allPlugins.length) : null;
  const selectedPlugins = selectPlugins(allPlugins, options, dailyState ?? undefined);
  const summaries: IndexPluginSummary[] = [];
  const startedAtMs = Date.now();
  let processed = 0;
  let nextCursorIndex = dailyState?.cursorIndex ?? 0;

  if (dailyState?.completed) {
    console.log(`Daily harvest already completed for ${dailyState.day}`);
    return;
  }

  console.log(describeSelection(options, selectedPlugins.length, dailyState));

  if (options.maxPlugins === 0) {
    console.log("Stopping after max plugin count 0");
    return;
  }

  for (let index = 0; index < selectedPlugins.length; index += 1) {
    const plugin = selectedPlugins[index];
    const existing = await readPluginData(plugin.id);
    const result = await harvestPlugin(github, plugin, existing, fetchedAt);
    processed += 1;

    summaries.push({
      id: plugin.id,
      repo: plugin.repo,
      chunk: chunkForPlugin(plugin.id, options.chunkCount),
      lastFetchedAt: result.data.lastFetchedAt,
      presentInCommunityList: true,
      removedAt: null,
    });

    if (!options.dryRun) {
      await writePluginData(result.data, existing);
      await writeJsonFile(httpCachePath, httpCache);
    }

    if (dailyState) {
      nextCursorIndex = dailyState.cursorIndex + index + 1;
    }

    const remaining = result.rateLimitRemaining;
    if (remaining !== null && remaining < options.rateLimitFloor) {
      console.log(`Stopping early because rate limit remaining (${remaining}) is below ${options.rateLimitFloor}`);
      break;
    }

    if (processed >= (options.maxPlugins ?? Number.POSITIVE_INFINITY)) {
      console.log(`Stopping after max plugin count ${options.maxPlugins}`);
      break;
    }

    if (Date.now() - startedAtMs >= options.maxRuntimeMinutes * 60_000) {
      console.log(`Stopping after max runtime ${options.maxRuntimeMinutes} minute(s)`);
      break;
    }
  }

  if (!options.dryRun) {
    await updateIndex(options.chunkCount, summaries, allPlugins, fetchedAt);
    await writePluginDownloadSummary(fetchedAt);

    if (dailyState) {
      await writeJsonFile(harvestRunPath, {
        ...dailyState,
        cursorIndex: Math.min(nextCursorIndex, allPlugins.length),
        completed: nextCursorIndex >= allPlugins.length,
        pluginCount: allPlugins.length,
        updatedAt: fetchedAt,
        requestStats: github.stats,
      });
    }
  }
}

export function parseCommunityPlugins(value: unknown): CommunityPlugin[] {
  if (!Array.isArray(value)) {
    throw new Error("Community plugin list is not an array");
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Community plugin entry is not an object");
    }

    const candidate = entry as Record<string, unknown>;
    const id = requiredString(candidate, "id");
    const repo = requiredString(candidate, "repo");

    return {
      id,
      repo,
      name: stringOrEmpty(candidate.name),
      author: stringOrEmpty(candidate.author),
      description: stringOrEmpty(candidate.description),
    };
  });
}

export function selectPlugins(
  plugins: CommunityPlugin[],
  options: HarvestOptions,
  dailyState?: HarvestRunState,
): CommunityPlugin[] {
  const selected = options.pluginId
    ? plugins.filter((plugin) => plugin.id === options.pluginId)
    : options.mode === "daily"
      ? plugins.slice(dailyState?.cursorIndex ?? 0)
      : plugins.filter((plugin) => chunkForPlugin(plugin.id, options.chunkCount) === options.chunkIndex);

  if (options.pluginId && selected.length === 0) {
    throw new Error(`Plugin id not found in community list: ${options.pluginId}`);
  }

  return selected;
}

export function simplifyRelease(release: GitHubRelease): ReleaseSummary {
  const assets = release.assets.map((asset) => ({
    name: asset.name,
    size: asset.size,
    downloadCount: asset.download_count,
    ...(asset.digest ? { digest: asset.digest } : {}),
  }));

  return {
    tag: release.tag_name,
    name: release.name,
    description: release.body,
    author: release.author?.login ?? null,
    publishedAt: release.published_at,
    prerelease: release.prerelease,
    draft: release.draft,
    downloadCount: assets
      .filter((asset) => asset.name === "main.js")
      .reduce((total, asset) => total + asset.downloadCount, 0),
    assets,
  };
}

async function harvestPlugin(
  github: GitHubRequester,
  plugin: CommunityPlugin,
  existing: PluginData | null,
  fetchedAt: string,
): Promise<HarvestPluginResult> {
  const errors: HarvestError[] = [];
  const [owner, repoName] = parseRepo(plugin.repo);
  let defaultBranch = existing?.defaultBranch ?? null;
  let manifest: unknown | null = existing?.manifest ?? null;
  let releases = existing?.releases ?? [];
  let rateLimitRemaining: number | null | undefined;

  try {
    const repoResponse = await github.request<GitHubRepo>(`/repos/${owner}/${repoName}`);
    rateLimitRemaining = repoResponse.rateLimit.remaining;

    if (!repoResponse.notModified && repoResponse.data) {
      defaultBranch = repoResponse.data.default_branch;
    }
  } catch (error) {
    errors.push(toHarvestError("repo", error));
  }

  if (defaultBranch) {
    try {
      const manifestResponse = await github.request<unknown>(
        `/repos/${owner}/${repoName}/contents/manifest.json?ref=${encodeURIComponent(defaultBranch)}`,
        { headers: { Accept: "application/vnd.github.raw+json" } },
      );
      rateLimitRemaining = manifestResponse.rateLimit.remaining;

      if (!manifestResponse.notModified && manifestResponse.data !== null) {
        manifest = parseManifestResponse(manifestResponse.data);
      }
    } catch (error) {
      errors.push(toHarvestError("manifest", error));
      manifest = null;
    }

    try {
      const releaseResult = await fetchReleases(github, owner, repoName, existing?.releases ?? []);
      rateLimitRemaining = releaseResult.rateLimitRemaining ?? rateLimitRemaining;
      releases = releaseResult.releases;
    } catch (error) {
      errors.push(toHarvestError("releases", error));
    }
  }

  const next: PluginData = {
    id: plugin.id,
    name: plugin.name,
    author: plugin.author,
    description: plugin.description,
    repo: plugin.repo,
    presentInCommunityList: true,
    removedAt: null,
    defaultBranch,
    manifest,
    releases,
    lastFetchedAt: fetchedAt,
    lastChangedAt: existing?.lastChangedAt ?? fetchedAt,
    errors,
  };

  const comparableExisting = existing ? { ...existing, lastFetchedAt: fetchedAt } : null;
  if (!comparableExisting || stableStringify(stripVolatile(next)) !== stableStringify(stripVolatile(comparableExisting))) {
    next.lastChangedAt = fetchedAt;
  } else if (existing) {
    next.lastFetchedAt = existing.lastFetchedAt;
  }

  return { data: next, rateLimitRemaining: rateLimitRemaining ?? null };
}

export async function fetchReleases(
  github: GitHubRequester,
  owner: string,
  repoName: string,
  existingReleases: ReleaseSummary[],
): Promise<{ releases: ReleaseSummary[]; rateLimitRemaining: number | null }> {
  let nextUrl: string | null = `/repos/${owner}/${repoName}/releases?per_page=100`;
  const releases: ReleaseSummary[] = [];
  let rateLimitRemaining: number | null = null;

  while (nextUrl) {
    // Asset download counts change without a new release tag, so release pages must always be refetched.
    const response = await github.request<GitHubRelease[]>(nextUrl, { conditional: false });
    rateLimitRemaining = response.rateLimit.remaining;

    if (response.notModified) {
      return { releases: existingReleases, rateLimitRemaining };
    }

    for (const release of response.data ?? []) {
      releases.push(simplifyRelease(release));
    }

    const links = parseLinkHeader(response.headers.get("link"));
    nextUrl = links.next ?? null;
  }

  return { releases, rateLimitRemaining };
}

async function readPluginData(pluginId: string): Promise<PluginData | null> {
  try {
    const raw = await readFile(pluginPath(pluginId), "utf8");
    return JSON.parse(raw) as PluginData;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writePluginData(next: PluginData, existing: PluginData | null): Promise<void> {
  const path = pluginPath(next.id);
  const serialized = stableStringify(next);

  if (existing && stableStringify(existing) === serialized) {
    return;
  }

  await mkdir("data/plugins", { recursive: true });
  await writeJsonFile(path, next);
}

async function updateIndex(
  chunkCount: number,
  summaries: IndexPluginSummary[],
  communityPlugins: CommunityPlugin[],
  fetchedAt: string,
): Promise<void> {
  const current = await readJsonFile<{
    generatedAt: string | null;
    chunkCount: number;
    plugins: IndexPluginSummary[];
  }>("data/index.json", { generatedAt: null, chunkCount, plugins: [] });

  const byId = new Map(current.plugins.map((plugin) => [plugin.id, plugin]));
  const communityPluginIds = new Set(communityPlugins.map((plugin) => plugin.id));

  for (const summary of summaries) {
    byId.set(summary.id, summary);
  }

  for (const [id, summary] of byId) {
    if (communityPluginIds.has(id)) {
      continue;
    }

    const removedAt = summary.removedAt ?? fetchedAt;
    byId.set(id, {
      ...summary,
      presentInCommunityList: false,
      removedAt,
    });
    await markPluginRemoved(id, removedAt, fetchedAt);
  }

  const next = {
    generatedAt: fetchedAt,
    chunkCount,
    plugins: Array.from(byId.values())
      .map((plugin) => ({
        ...plugin,
        chunk: chunkForPlugin(plugin.id, chunkCount),
        presentInCommunityList: plugin.presentInCommunityList ?? communityPluginIds.has(plugin.id),
        removedAt: plugin.removedAt ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };

  const comparableCurrent = { ...current, generatedAt: fetchedAt };
  if (stableStringify(next) === stableStringify(comparableCurrent)) {
    return;
  }

  await writeJsonFile("data/index.json", next);
}

async function markPluginRemoved(pluginId: string, removedAt: string, changedAt: string): Promise<void> {
  const existing = await readPluginData(pluginId);

  if (!existing || existing.presentInCommunityList === false) {
    return;
  }

  await writePluginData(
    {
      ...existing,
      presentInCommunityList: false,
      removedAt,
      lastChangedAt: changedAt,
    },
    existing,
  );
}

async function readDailyState(fetchedAt: string, day: string, pluginCount: number): Promise<HarvestRunState> {
  const fallback: HarvestRunState = {
    day,
    cursorIndex: 0,
    completed: false,
    pluginCount,
    startedAt: fetchedAt,
    updatedAt: fetchedAt,
  };
  const existing = await readJsonFile<HarvestRunState>(harvestRunPath, fallback);

  return normalizeDailyState(existing, fallback, pluginCount);
}

export function normalizeDailyState(
  existing: HarvestRunState,
  fallback: HarvestRunState,
  pluginCount: number,
): HarvestRunState {
  const existingDay = existing.day;
  const fallbackDay = fallback.day;

  if (existing.completed && existingDay === fallbackDay) {
    return {
      ...fallback,
      ...existing,
      completed: true,
      cursorIndex: pluginCount,
      pluginCount,
    };
  }

  if (existing.completed || existing.cursorIndex >= pluginCount) {
    return fallback;
  }

  return {
    ...fallback,
    ...existing,
    completed: false,
    cursorIndex: Math.max(0, existing.cursorIndex),
    pluginCount,
  };
}

function formatLocalDay(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function describeSelection(
  options: HarvestOptions,
  selectedCount: number,
  dailyState: HarvestRunState | null,
): string {
  if (options.pluginId) {
    return `Processing plugin ${options.pluginId}`;
  }

  if (dailyState) {
    return `Processing daily harvest from index ${dailyState.cursorIndex}/${dailyState.pluginCount}`;
  }

  return `Processing ${selectedCount} plugin(s) for chunk ${options.chunkIndex}/${options.chunkCount}`;
}

function parseManifestResponse(data: unknown): unknown {
  if (typeof data === "string") {
    return JSON.parse(data);
  }

  if (data && typeof data === "object" && "content" in data) {
    const content = (data as { content?: unknown }).content;
    if (typeof content === "string") {
      return JSON.parse(Buffer.from(content, "base64").toString("utf8"));
    }
  }

  return data;
}

function pluginPath(pluginId: string): string {
  return join("data/plugins", `${safeFileName(pluginId)}.json`);
}

function safeFileName(pluginId: string): string {
  return basename(pluginId).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseRepo(repo: string): [string, string] {
  const match = repo.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) {
    throw new Error(`Invalid repo '${repo}', expected owner/name`);
  }

  return [match[1], match[2]];
}

function toHarvestError(kind: string, error: unknown): HarvestError {
  if (error instanceof GitHubHttpError) {
    return {
      kind,
      status: error.status,
      message: compactMessage(error.body || error.message),
    };
  }

  return {
    kind,
    message: error instanceof Error ? error.message : String(error),
  };
}

function compactMessage(message: string): string {
  return message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2).join(" ");
}

function stripVolatile(data: PluginData): Omit<PluginData, "lastFetchedAt" | "lastChangedAt"> {
  const { lastFetchedAt: _lastFetchedAt, lastChangedAt: _lastChangedAt, ...stable } = data;
  return stable;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Community plugin entry is missing string field '${key}'`);
  }

  return value;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function validateOptions(options: HarvestOptions): void {
  if (options.mode !== "daily" && options.mode !== "chunk") {
    throw new Error("--mode must be daily or chunk");
  }

  if (!Number.isInteger(options.chunkCount) || options.chunkCount < 1) {
    throw new Error("--chunk-count must be a positive integer");
  }

  if (options.pluginId && options.chunkIndex === undefined) {
    options.chunkIndex = 0;
  }

  const chunkIndex = options.chunkIndex;
  if (
    options.mode === "chunk" &&
    (typeof chunkIndex !== "number" ||
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      chunkIndex >= options.chunkCount)
  ) {
    throw new Error("--chunk-index must be an integer between 0 and chunk-count - 1");
  }

  if (!Number.isInteger(options.rateLimitFloor) || options.rateLimitFloor < 0) {
    throw new Error("--rate-limit-floor must be a non-negative integer");
  }

  if (
    options.maxPlugins !== undefined &&
    (!Number.isInteger(options.maxPlugins) || options.maxPlugins < 0)
  ) {
    throw new Error("--max-plugins must be a non-negative integer");
  }

  if (!Number.isInteger(options.maxRuntimeMinutes) || options.maxRuntimeMinutes < 1) {
    throw new Error("--max-runtime-minutes must be a positive integer");
  }

}
