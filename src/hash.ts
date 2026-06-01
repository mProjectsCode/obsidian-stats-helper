export function stableHash(input: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

export function chunkForPlugin(pluginId: string, chunkCount: number): number {
  if (!Number.isInteger(chunkCount) || chunkCount < 1) {
    throw new Error(`chunkCount must be a positive integer, got ${chunkCount}`);
  }

  return stableHash(pluginId) % chunkCount;
}

