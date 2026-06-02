#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

env_file="${ENV_FILE:-$HOME/.config/obsidian-stats-helper/env}"
if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${GITHUB_TOKEN:-}" && -n "${GITHUB_PAT:-}" ]]; then
  export GITHUB_TOKEN="$GITHUB_PAT"
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "GITHUB_TOKEN or GITHUB_PAT must be set."
  echo "Set it in $env_file or in .env. See .env.example for the expected format."
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun must be installed and available on PATH."
  echo "Install Bun from https://bun.sh/docs/installation, then rerun this command."
  exit 1
fi

mkdir -p data/state

lock_file="${LOCK_FILE:-data/state/harvest.lock}"
exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Harvest already running; exiting"
  exit 0
fi

askpass="$(mktemp)"
cleanup() {
  rm -f "$askpass"
}
trap cleanup EXIT

cat >"$askpass" <<'EOF'
#!/usr/bin/env sh
case "$1" in
  *Username*) printf '%s\n' "${GIT_USERNAME:-x-access-token}" ;;
  *) printf '%s\n' "$GITHUB_TOKEN" ;;
esac
EOF
chmod 700 "$askpass"

export GIT_ASKPASS="$askpass"
export GIT_TERMINAL_PROMPT=0
export GIT_USERNAME="${GIT_USERNAME:-x-access-token}"

branch="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
max_plugins="${MAX_PLUGINS:-500}"
max_runtime_minutes="${MAX_RUNTIME_MINUTES:-25}"
rate_limit_floor="${RATE_LIMIT_FLOOR:-100}"

if [[ ! -d node_modules ]]; then
  bun install --frozen-lockfile
fi

git pull --rebase origin "$branch"

bun run harvest -- \
  --daily \
  --max-plugins "$max_plugins" \
  --max-runtime-minutes "$max_runtime_minutes" \
  --rate-limit-floor "$rate_limit_floor"

if git diff --quiet -- data ':!data/state'; then
  echo "No data changes"
  exit 0
fi

bun run status

git config user.name "${GIT_COMMITTER_NAME:-obsidian-stats-helper-pi}"
git config user.email "${GIT_COMMITTER_EMAIL:-obsidian-stats-helper-pi@users.noreply.github.com}"
git add data STATUS.md
git commit -m "${COMMIT_MESSAGE:-Update plugin metadata}"
git pull --rebase origin "$branch"
git push origin "$branch"
