#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_FILE="$ROOT_DIR/deploy/antarctic.service"

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
$SUDO systemctl daemon-reload
$SUDO systemctl enable antarctic.service
$SUDO systemctl restart antarctic.service
$SUDO systemctl --no-pager --full status antarctic.service
