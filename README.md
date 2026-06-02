# Obsidian Stats Helper

Collects release and manifest metadata for Obsidian community plugins.

## Quick Start

Prerequisites:

- Git
- Bun
- A GitHub token if you want authenticated requests or automated pushes

Install dependencies:

```sh
bun install --frozen-lockfile
```

Run a small local check without writing data:

```sh
bun run harvest -- --plugin-id obsidian-git --dry-run
```

Run the rolling daily harvest:

```sh
bun run harvest -- --daily
```

Show all CLI options:

```sh
bun run harvest -- --help
```

## Common Commands

```sh
bun run harvest -- --daily
bun run harvest -- --plugin-id obsidian-git --chunk-index 0 --chunk-count 8 --dry-run
bun run harvest -- --chunk-index 0 --chunk-count 8
bun run harvest:pi
bun run setup:pi
bun run status:pi
bun run logs:pi
bun test
```

## Configuration

The harvester reads `GITHUB_TOKEN` from the environment. For local one-off runs, you can
create a private `.env` file from the example:

```sh
cp .env.example .env
chmod 600 .env
```

Then edit `.env` and replace `github_pat_replace_me`.

The Raspberry Pi runner in `scripts/harvest-pi.sh` pulls the current branch, runs a daily
harvest, commits changes under `data/`, rebases again, and pushes. It uses `GITHUB_TOKEN`
or `GITHUB_PAT` for both API requests and Git push authentication.

The hourly timer acts as a resumable worker for the current day's pass. The runner stores
its local cursor in `data/state/harvest-run.json`, keeps working from that cursor until the
pass reaches the end of the plugin list, then exits without work for the rest of the local
calendar day. On the next local calendar day, it starts a new pass from the beginning.

Runtime state and GitHub conditional-request cache files under `data/state/` are local to
the runner and are not committed. Git history should mostly show actual metadata changes,
not cursor movement or HTTP cache churn.

The harvester uses conditional GitHub requests. Chunk mode remains available for manual
debugging.

## Raspberry Pi setup

Install a 64-bit Raspberry Pi OS, Git, and Bun. Clone this repository, install
dependencies, then run the installer from the repository root:

```sh
bun install --frozen-lockfile
bun run setup:pi
```

The installer:

- creates `~/.config/obsidian-stats-helper/env` if it does not exist
- writes a systemd user service that points at the current checkout path
- installs and starts the hourly user timer
- enables user lingering when `loginctl` is available

Edit `~/.config/obsidian-stats-helper/env` and set `GITHUB_TOKEN` to a fine-grained
GitHub PAT with repository contents read/write access. Then start one manual run:

```sh
systemctl --user start obsidian-stats-helper.service
```

Check runs with:

```sh
systemctl --user status obsidian-stats-helper.timer
journalctl --user -u obsidian-stats-helper.service -n 100
```

## Troubleshooting

- `GITHUB_TOKEN or GITHUB_PAT must be set`: edit `~/.config/obsidian-stats-helper/env`
  or `.env` and add a token.
- `bun must be installed and available on PATH`: install Bun and open a new shell, or
  make sure `~/.bun/bin` is on `PATH`.
- Service points at the wrong checkout: rerun `bun run setup:pi` from the repository
  directory you want the timer to use.
