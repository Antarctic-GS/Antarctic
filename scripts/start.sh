#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELAY_PACKAGE_DIR="$ROOT_DIR/assets/relay/package"
WISP_BIN="$RELAY_PACKAGE_DIR/node_modules/.bin/wisp-js-server"
ALTCHA_MODULE="$RELAY_PACKAGE_DIR/node_modules/altcha-lib/package.json"
WISP_HOST="127.0.0.1"
WISP_PORT="5001"
WISP_TLS_PORT="5002"
SITE_PORT="3000"
HTTPS_PORT="3443"
CERT_DIR="$ROOT_DIR/.runtime-certs"
CERT_FILE="$CERT_DIR/antarctic.crt"
KEY_FILE="$CERT_DIR/antarctic.key"

stop_existing_listener() {
  local port="$1"
  local existing_pids=""

  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  existing_pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$existing_pids" ]]; then
    return
  fi

  echo "Stopping the existing Antarctic listener on port $port..."
  kill $existing_pids 2>/dev/null || true
}

stop_existing_antarctic() {
  stop_existing_listener "$HTTPS_PORT"
  stop_existing_listener "$WISP_TLS_PORT"
  stop_existing_listener "$WISP_PORT"
  stop_existing_listener "$SITE_PORT"
}

install_node_runtime() {
  local privilege=""
  if [[ "$(id -u)" -ne 0 ]]; then
    if ! command -v sudo >/dev/null 2>&1; then
      echo "Node.js is missing and sudo is unavailable." >&2
      exit 1
    fi
    privilege="sudo"
  fi

  echo "Node.js/npm not found. Installing the runtime..."
  if command -v apt-get >/dev/null 2>&1; then
    $privilege apt-get update
    $privilege apt-get install -y nodejs npm
  elif command -v dnf >/dev/null 2>&1; then
    $privilege dnf install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    $privilege yum install -y nodejs npm
  elif command -v apk >/dev/null 2>&1; then
    $privilege apk add --no-cache nodejs npm
  else
    echo "Cannot install Node.js/npm: no supported system package manager was found." >&2
    exit 1
  fi
}

if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  install_node_runtime
fi

if [[ ! -x "$WISP_BIN" || ! -f "$ALTCHA_MODULE" ]]; then
  echo "Wisp server not found. Installing relay dependencies..."
  if command -v pnpm >/dev/null 2>&1; then
    (cd "$RELAY_PACKAGE_DIR" && pnpm install --frozen-lockfile)
  elif command -v npm >/dev/null 2>&1; then
    (cd "$RELAY_PACKAGE_DIR" && npm install --no-audit --no-fund)
  elif command -v corepack >/dev/null 2>&1; then
    (cd "$RELAY_PACKAGE_DIR" && corepack pnpm install --frozen-lockfile)
  else
    echo "Cannot install relay dependencies: pnpm, corepack, and npm are unavailable." >&2
    exit 1
  fi
fi

if [[ ! -x "$WISP_BIN" || ! -f "$ALTCHA_MODULE" ]]; then
  echo "Relay dependency installation completed, but the required relay/CAPTCHA dependencies are unavailable." >&2
  exit 1
fi

cd "$ROOT_DIR"

stop_existing_antarctic

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
ANTARCTIC_SITE_ROOT="$ROOT_DIR" \
ANTARCTIC_SITE_PORT="$SITE_PORT" \
ALTCHA_HMAC_SECRET="${ALTCHA_HMAC_SECRET:-local-development-secret-change-me}" \
node "$ROOT_DIR/scripts/antarctic-site-server.mjs" &
SITE_PID=$!
ANTARCTIC_SITE_ROOT="$ROOT_DIR" \
ANTARCTIC_SITE_PORT="$HTTPS_PORT" \
ANTARCTIC_TLS_CERT="$CERT_FILE" \
ANTARCTIC_TLS_KEY="$KEY_FILE" \
ALTCHA_HMAC_SECRET="${ALTCHA_HMAC_SECRET:-local-development-secret-change-me}" \
node "$ROOT_DIR/scripts/antarctic-site-server.mjs" &
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
