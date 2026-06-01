export interface CommunityPlugin {
  id: string;
  name: string;
  author: string;
  description: string;
  repo: string;
}

export interface ReleaseAssetSummary {
  name: string;
  size: number;
  digest?: string;
}

export interface ReleaseSummary {
  tag: string;
  name: string | null;
  description: string | null;
  author: string | null;
  publishedAt: string | null;
  prerelease: boolean;
  draft: boolean;
  assets: ReleaseAssetSummary[];
}

export interface PluginData {
  id: string;
  name: string;
  author: string;
  description: string;
  repo: string;
  presentInCommunityList: boolean;
  removedAt: string | null;
  defaultBranch: string | null;
  manifest: unknown | null;
  releases: ReleaseSummary[];
  lastFetchedAt: string;
  lastChangedAt: string | null;
  errors: HarvestError[];
}

export interface HarvestError {
  kind: string;
  message: string;
  status?: number;
}

export interface HttpCacheFile {
  entries: Record<string, HttpCacheEntry>;
}

export interface HttpCacheEntry {
  etag?: string;
  lastModified?: string;
}

export interface RateLimit {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
}

export interface HarvestOptions {
  mode: "daily" | "chunk";
  chunkIndex?: number;
  chunkCount: number;
  pluginId?: string;
  dryRun: boolean;
  maxPlugins?: number;
  maxRuntimeMinutes: number;
  rateLimitFloor: number;
}

export interface HarvestRunState {
  day: string | null;
  cursorIndex: number;
  completed: boolean;
  pluginCount: number;
  startedAt: string | null;
  updatedAt: string | null;
}
