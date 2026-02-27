#!/bin/sh

echo "=== The Dojo startup ==="
echo "PORT=$PORT"
echo "NODE_ENV=$NODE_ENV"

# Ensure persistent data directories exist
mkdir -p /data/brands /data/uploads /data/video-analysis

# Symlink from the paths the app expects to the persistent volume
ln -sfn /data/uploads /tmp/uploads
ln -sfn /data/video-analysis /tmp/video-analysis
mkdir -p /app/data
ln -sfn /data/brands /app/data/brands

echo "Data directories ready"

# Start the API server in the background with auto-restart
(while true; do
  echo "[API] Starting on port 3001..."
  node /app/packages/api/dist/index.js 2>&1 || true
  echo "[API] Process exited, restarting in 2s..."
  sleep 2
done) &

# Verify standalone server exists
STANDALONE="/app/packages/web/.next/standalone/packages/web/server.js"
if [ ! -f "$STANDALONE" ]; then
  echo "[WEB] ERROR: server.js not found at $STANDALONE"
  echo "[WEB] Listing .next/standalone/:"
  find /app/packages/web/.next/standalone -name "server.js" 2>&1 || true
  ls -la /app/packages/web/.next/standalone/ 2>&1 || true
  exit 1
fi

echo "[WEB] Found standalone server at $STANDALONE"

# Set env vars explicitly via export (not inline) for reliability
export HOSTNAME="0.0.0.0"
export PORT="${PORT:-3000}"

echo "[WEB] Starting Next.js standalone on $HOSTNAME:$PORT..."
exec node "$STANDALONE"
