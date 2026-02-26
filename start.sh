#!/bin/sh
set -e

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

# Wait for API to be ready (up to 30s)
echo "[API] Waiting for health check..."
API_READY=0
for i in $(seq 1 30); do
  if node -e "fetch('http://localhost:3001/api/health').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "[API] Ready after ${i}s"
    API_READY=1
    break
  fi
  sleep 1
done

if [ "$API_READY" = "0" ]; then
  echo "[API] WARNING: API not responding after 30s, starting Next.js anyway"
fi

# Start Next.js in the foreground
echo "[WEB] Starting Next.js on port ${PORT:-3000}..."
cd /app/packages/web
exec /app/node_modules/.bin/next start -p ${PORT:-3000} -H 0.0.0.0
