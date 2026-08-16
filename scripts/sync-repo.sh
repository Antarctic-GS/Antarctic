#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${ANTARCTIC_REMOTE:-origin}"
BRANCH="${ANTARCTIC_BRANCH:-main}"
LOCK_FILE="/run/lock/antarctic-repo-sync.lock"

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

GIT_TERMINAL_PROMPT=0 git -C "$ROOT_DIR" pull --ff-only --quiet "$REMOTE" "$BRANCH"
