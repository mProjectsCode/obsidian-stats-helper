import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isNotFound(error)) {
      return fallback;
    }

    throw error;
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, `${stableStringify(value)}\n`, "utf8");
  await rename(tempPath, path);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortForJson(value), null, 2);
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortForJson(record[key]);
    }

    return sorted;
  }

  return value;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
