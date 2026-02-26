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
  node /app/packages/api/dist/index.js || true
  echo "[API] Process exited, restarting in 2s..."
  sleep 2
done) &

# Start Next.js in the foreground immediately
# (No need to wait for API — /api/health is handled by Next.js directly)
echo "[WEB] Starting Next.js on port ${PORT:-3000}..."
cd /app/packages/web
exec /app/node_modules/.bin/next start -p ${PORT:-3000} -H 0.0.0.0
