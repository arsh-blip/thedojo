#!/bin/sh

echo "=== The Dojo startup ==="

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

# Start Next.js standalone server in the foreground
echo "[WEB] Starting Next.js standalone on port ${PORT:-3000}..."
HOSTNAME=0.0.0.0 PORT=${PORT:-3000} exec node /app/packages/web/.next/standalone/packages/web/server.js
