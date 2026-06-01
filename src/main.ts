import { runHarvest } from "./harvester.ts";
import type { HarvestOptions } from "./types.ts";

try {
  const options = parseArgs(process.argv.slice(2));

  if (options === "help") {
    console.log(usage());
    process.exit(0);
  }

  await runHarvest(options);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  console.error("Run `bun run harvest -- --help` for usage.");
  process.exit(1);
}

function parseArgs(args: string[]): HarvestOptions | "help" {
  const values = new Map<string, string | true>();
  const knownOptions = new Set([
    "chunkCount",
    "chunkIndex",
    "daily",
    "dryRun",
    "help",
    "maxPlugins",
    "maxRuntimeMinutes",
    "pluginId",
    "rateLimitFloor",
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = normalizeKey(rawKey);

    if (!knownOptions.has(key)) {
      throw new Error(`Unknown option: --${rawKey}`);
    }

    if (inlineValue !== undefined) {
      values.set(key, inlineValue);
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, true);
      continue;
    }

    values.set(key, next);
    index += 1;
  }

  if (values.has("help")) {
    return "help";
  }

  const chunkCount = readInteger(values, "chunkCount", 8);
  const mode = values.has("daily") && !values.has("pluginId")
    ? "daily"
    : values.has("chunkIndex") || values.has("pluginId")
      ? "chunk"
      : "daily";
  const chunkIndex = values.has("chunkIndex") ? readInteger(values, "chunkIndex", Number.NaN) : undefined;
  const maxPlugins = values.has("maxPlugins") ? readInteger(values, "maxPlugins", Number.NaN) : undefined;

  return {
    mode,
    chunkIndex,
    chunkCount,
    pluginId: readOptionalString(values, "pluginId"),
    dryRun: values.get("dryRun") === true || values.get("dryRun") === "true",
    maxPlugins,
    maxRuntimeMinutes: readInteger(values, "maxRuntimeMinutes", 25),
    rateLimitFloor: readInteger(values, "rateLimitFloor", 100),
  };
}

function usage(): string {
  return `Usage:
  bun run harvest -- --daily [options]
  bun run harvest -- --plugin-id <id> [options]
  bun run harvest -- --chunk-index <index> --chunk-count <count> [options]

Options:
  --daily                         Resume the rolling daily harvest (default)
  --plugin-id <id>                Harvest one plugin from the community list
  --chunk-index <index>           Harvest one deterministic chunk
  --chunk-count <count>           Total chunk count (default: 8)
  --max-plugins <count>           Stop after this many plugins
  --max-runtime-minutes <minutes> Stop after this runtime (default: 25)
  --rate-limit-floor <count>      Stop below this GitHub rate limit (default: 100)
  --dry-run                       Fetch without writing data files
  --help                          Show this help

Examples:
  bun run harvest -- --daily
  bun run harvest -- --plugin-id obsidian-git --dry-run
  bun run harvest -- --chunk-index 0 --chunk-count 8 --max-plugins 25`;
}

function normalizeKey(key: string): string {
  return key.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function readInteger(values: Map<string, string | true>, key: string, fallback: number): number {
  const value = values.get(key);
  if (value === undefined) {
    return fallback;
  }

  if (value === true) {
    throw new Error(`--${key} requires a value`);
  }

  if (!/^-?\d+$/.test(value)) {
    throw new Error(`--${key} must be an integer`);
  }

  const parsed = Number.parseInt(value, 10);
  return parsed;
}

function readOptionalString(values: Map<string, string | true>, key: string): string | undefined {
  const value = values.get(key);

  if (value === undefined) {
    return undefined;
  }

  if (value === true) {
    throw new Error(`--${key} requires a value`);
  }

  return value;
}
