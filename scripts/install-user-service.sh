#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config_dir="${CONFIG_DIR:-$HOME/.config/obsidian-stats-helper}"
systemd_dir="${SYSTEMD_USER_DIR:-$HOME/.config/systemd/user}"
env_file="${ENV_FILE:-$config_dir/env}"
service_file="$systemd_dir/obsidian-stats-helper.service"
timer_file="$systemd_dir/obsidian-stats-helper.timer"

mkdir -p "$config_dir" "$systemd_dir"

if [[ ! -f "$env_file" ]]; then
  cp "$repo_dir/.env.example" "$env_file"
  chmod 600 "$env_file"
  echo "Created $env_file"
  echo "Edit it and replace github_pat_replace_me with a GitHub token before the first run."
else
  chmod 600 "$env_file"
  echo "Using existing $env_file"
fi

cat >"$service_file" <<EOF
[Unit]
Description=Harvest Obsidian plugin metadata
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$repo_dir
EnvironmentFile=$env_file
Environment=PATH=%h/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$repo_dir/scripts/harvest-pi.sh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF

cp "$repo_dir/systemd/user/obsidian-stats-helper.timer" "$timer_file"

systemctl --user daemon-reload
systemctl --user enable --now obsidian-stats-helper.timer

if command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "$USER" || true
fi

cat <<EOF

Installed user timer:
  $timer_file
  $service_file

Next steps:
  1. Edit $env_file and set GITHUB_TOKEN.
  2. Run: systemctl --user start obsidian-stats-helper.service
  3. Check: journalctl --user -u obsidian-stats-helper.service -n 100
EOF
