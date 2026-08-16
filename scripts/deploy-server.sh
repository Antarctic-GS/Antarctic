#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_FILE="$ROOT_DIR/deploy/antarctic.service"
SYNC_SERVICE_FILE="$ROOT_DIR/deploy/antarctic-repo-sync.service"
SYNC_TIMER_FILE="$ROOT_DIR/deploy/antarctic-repo-sync.timer"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required to deploy Antarctic as a service." >&2
  exit 1
fi

$SUDO install -m 0644 "$SERVICE_FILE" /etc/systemd/system/antarctic.service
$SUDO install -m 0644 "$SYNC_SERVICE_FILE" /etc/systemd/system/antarctic-repo-sync.service
$SUDO install -m 0644 "$SYNC_TIMER_FILE" /etc/systemd/system/antarctic-repo-sync.timer
$SUDO systemctl daemon-reload
$SUDO systemctl enable antarctic.service
$SUDO systemctl enable --now antarctic-repo-sync.timer
$SUDO systemctl restart antarctic.service
$SUDO systemctl --no-pager --full status antarctic.service
$SUDO systemctl --no-pager --full status antarctic-repo-sync.timer
