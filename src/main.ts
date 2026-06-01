import { runHarvest } from "./harvester.ts";
import type { HarvestOptions } from "./types.ts";

const options = parseArgs(process.argv.slice(2));

await runHarvest(options);

function parseArgs(args: string[]): HarvestOptions {
  const values = new Map<string, string | true>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = normalizeKey(rawKey);

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
