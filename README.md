# Obsidian Stats Helper

Collects release and manifest metadata for Obsidian community plugins.

## Commands

```sh
bun run harvest -- --daily
bun run harvest -- --plugin-id obsidian-git --chunk-index 0 --chunk-count 8 --dry-run
bun run harvest -- --chunk-index 0 --chunk-count 8
bun run harvest:pi
bun test
```

The Raspberry Pi runner in `scripts/harvest-pi.sh` pulls the current branch, runs a daily
harvest, commits changes under `data/`, rebases again, and pushes. It uses `GITHUB_TOKEN`
or `GITHUB_PAT` for both API requests and Git push authentication.

The runner resumes its cursor from `data/state/harvest-run.json`. The cursor is kept across
calendar days until the pass reaches the end of the plugin list; the next run then starts a
new pass from the beginning.

The harvester uses conditional GitHub requests. Chunk mode remains available for manual
debugging.

## Raspberry Pi setup

Install a 64-bit Raspberry Pi OS, Git, and Bun. Clone this repository to
`~/src/obsidian-stats-helper`, then create the runner environment:

```sh
mkdir -p ~/.config/obsidian-stats-helper
cp .env.example ~/.config/obsidian-stats-helper/env
chmod 600 ~/.config/obsidian-stats-helper/env
```

Edit `~/.config/obsidian-stats-helper/env` and set `GITHUB_TOKEN` to a fine-grained GitHub
PAT with repository contents read/write access. Then install and start the user timer:

```sh
mkdir -p ~/.config/systemd/user
cp systemd/user/obsidian-stats-helper.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now obsidian-stats-helper.timer
loginctl enable-linger "$USER"
```

Check runs with:

```sh
systemctl --user status obsidian-stats-helper.timer
journalctl --user -u obsidian-stats-helper.service -n 100
```
