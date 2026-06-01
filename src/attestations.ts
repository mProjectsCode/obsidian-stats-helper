import { spawn } from "node:child_process";
import type { AttestationCacheFile, AttestationCacheEntry, ReleaseSummary } from "./types.ts";

const ghReleaseVerifyTimeoutMs = 60_000;
const ghReleaseVerifyKillGraceMs = 5_000;

export async function checkReleaseAttestation(
  cache: AttestationCacheFile,
  repo: string,
  release: ReleaseSummary,
  checkedAt: string,
): Promise<AttestationCacheEntry> {
  const cacheKey = attestationCacheKey(repo, release);
  const cached = cache.entries[cacheKey];

  if (cached) {
    return cached;
  }

  const result = await runGhReleaseVerify(repo, release.tag);
  const entry: AttestationCacheEntry = {
    hasReleaseAttestation: result.ok ? true : result.cacheable ? false : null,
    checkedAt,
    ...(result.error ? { error: result.error } : {}),
  };

  if (result.cacheable) {
    cache.entries[cacheKey] = entry;
  }

  return entry;
}

export function getCachedAttestation(
  cache: AttestationCacheFile,
  repo: string,
  release: ReleaseSummary,
): AttestationCacheEntry | null {
  return cache.entries[attestationCacheKey(repo, release)] ?? null;
}

export function attestationCacheKey(repo: string, release: ReleaseSummary): string {
  const assetFingerprint = release.assets
    .map((asset) => `${asset.name}:${asset.size}:${asset.digest ?? ""}`)
    .sort()
    .join("|");

  return `${repo}:${release.tag}:${assetFingerprint}`;
}

async function runGhReleaseVerify(repo: string, tag: string): Promise<{ ok: boolean; cacheable: boolean; error?: string }> {
  const child = spawn("gh", ["release", "verify", tag, "--repo", repo, "--format", "json"], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let timedOut = false;
  let killTimeout: Timer | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    killTimeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, ghReleaseVerifyKillGraceMs);
  }, ghReleaseVerifyTimeoutMs);

  const [stdout, stderr, code] = await Promise.all([
    readStream(child.stdout),
    readStream(child.stderr),
    new Promise<number | null>((resolve) => {
      child.once("error", () => resolve(null));
      child.once("close", resolve);
    }),
  ]);
  clearTimeout(timeout);
  if (killTimeout) {
    clearTimeout(killTimeout);
  }

  if (code === 0) {
    return { ok: true, cacheable: true };
  }

  const message = (
    timedOut
      ? `gh release verify timed out after ${ghReleaseVerifyTimeoutMs}ms`
      : stderr || stdout || `gh release verify exited with ${code}`
  ).trim();
  const error = compactError(message);
  return { ok: false, cacheable: isCacheableMissingAttestation(error), error };
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  let output = "";

  for await (const chunk of stream) {
    output += String(chunk);
  }

  return output;
}

function compactError(message: string): string {
  return message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 3).join(" ");
}

function isCacheableMissingAttestation(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("no attestations found") || normalized.includes("no attestations were found");
}
