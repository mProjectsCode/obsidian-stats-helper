# Obsidian Stats Helper

Collects release and manifest metadata for Obsidian community plugins.

## Commands

```sh
bun run harvest -- --daily
bun run harvest -- --plugin-id obsidian-git --chunk-index 0 --chunk-count 8 --dry-run
bun run harvest -- --chunk-index 0 --chunk-count 8
bun run harvest -- --chunk-index 0 --chunk-count 8 --attestation-budget 10
bun test
```

The scheduled GitHub Actions workflow runs every two hours and resumes a daily cursor from
`data/state/harvest-run.json`. Once the daily pass reaches the end of the plugin list, later
runs that same day exit without processing more plugins.

The harvester uses conditional GitHub requests and a bounded number of new release attestation
checks per run. Chunk mode remains available for manual debugging.
