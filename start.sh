#!/bin/sh
set -e

# Ensure persistent data directories exist
mkdir -p /data/brands /data/uploads /data/video-analysis

# Symlink from the paths the app expects to the persistent volume
ln -sfn /data/uploads /tmp/uploads
ln -sfn /data/video-analysis /tmp/video-analysis
mkdir -p /app/data
ln -sfn /data/brands /app/data/brands

# Start the API server in the background with auto-restart
(while true; do
  echo "Starting API server..."
  node /app/packages/api/dist/index.js || true
  echo "API process exited, restarting in 2s..."
  sleep 2
done) &

# Wait for API to be ready
echo "Waiting for API server..."
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if node -e "fetch('http://localhost:3001/api/health').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "API server ready"
    break
  fi
  sleep 1
done

# Start Next.js in the foreground (Railway injects PORT)
cd /app/packages/web
exec npx next start -p ${PORT:-3000}
