#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELAY_PACKAGE_DIR="$ROOT_DIR/assets/relay/package"
WISP_BIN="$RELAY_PACKAGE_DIR/node_modules/.bin/wisp-js-server"
WISP_HOST="127.0.0.1"
WISP_PORT="5001"
WISP_TLS_PORT="5002"
HTTPS_PORT="3443"
CERT_DIR="$ROOT_DIR/.runtime-certs"
CERT_FILE="$CERT_DIR/antarctic.crt"
KEY_FILE="$CERT_DIR/antarctic.key"

if [[ ! -x "$WISP_BIN" ]]; then
  echo "Wisp server not found. Installing relay dependencies..."
  if command -v pnpm >/dev/null 2>&1; then
    (cd "$RELAY_PACKAGE_DIR" && pnpm install --frozen-lockfile)
  elif command -v corepack >/dev/null 2>&1; then
    (cd "$RELAY_PACKAGE_DIR" && corepack pnpm install --frozen-lockfile)
  elif command -v npm >/dev/null 2>&1; then
    (cd "$RELAY_PACKAGE_DIR" && npm install --no-audit --no-fund)
  else
    echo "Cannot install relay dependencies: pnpm, corepack, and npm are unavailable." >&2
    exit 1
  fi
fi

if [[ ! -x "$WISP_BIN" ]]; then
  echo "Relay dependency installation completed, but Wisp is still unavailable." >&2
  exit 1
fi

cd "$ROOT_DIR"

LAN_IP="${ANTARCTIC_LAN_IP:-}"
if [[ -z "$LAN_IP" ]] && command -v ipconfig >/dev/null 2>&1; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
fi
if [[ -z "$LAN_IP" ]]; then
  LAN_IP="127.0.0.1"
fi

mkdir -p "$CERT_DIR"
if [[ ! -f "$CERT_FILE" || ! -f "$KEY_FILE" ]]; then
  umask 077
  openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days 365 \
    -subj "/CN=$LAN_IP" \
    -addext "subjectAltName=IP:$LAN_IP" \
    >/dev/null 2>&1
fi

"$WISP_BIN" --host "$WISP_HOST" --port "$WISP_PORT" &
WISP_PID=$!
ANTARCTIC_TLS_CERT="$CERT_FILE" \
ANTARCTIC_TLS_KEY="$KEY_FILE" \
ANTARCTIC_WISP_PORT="$WISP_PORT" \
ANTARCTIC_WISP_TLS_PORT="$WISP_TLS_PORT" \
node "$ROOT_DIR/scripts/wisp-tls-proxy.js" &
WISP_TLS_PID=$!
npx serve . --listen "tcp://0.0.0.0:3000" --no-port-switching --no-clipboard &
SITE_PID=$!
npx serve . \
  --listen "tcp://0.0.0.0:$HTTPS_PORT" \
  --ssl-cert "$CERT_FILE" \
  --ssl-key "$KEY_FILE" \
  --no-port-switching \
  --no-clipboard &
HTTPS_SITE_PID=$!

cleanup() {
  kill "$SITE_PID" "$HTTPS_SITE_PID" "$WISP_TLS_PID" "$WISP_PID" 2>/dev/null || true
  wait "$SITE_PID" "$HTTPS_SITE_PID" "$WISP_TLS_PID" "$WISP_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

while kill -0 "$SITE_PID" 2>/dev/null \
  && kill -0 "$HTTPS_SITE_PID" 2>/dev/null \
  && kill -0 "$WISP_TLS_PID" 2>/dev/null \
  && kill -0 "$WISP_PID" 2>/dev/null; do
  sleep 1
done
