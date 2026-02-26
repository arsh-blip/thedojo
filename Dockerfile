FROM node:20-slim

# Install ffmpeg for video frame extraction
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything and install
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/ ./packages/

RUN npm ci

# Build in dependency order
RUN npm run build -w packages/services && \
    npm run build -w packages/api && \
    npm run build -w packages/web

# Prune dev dependencies after build
RUN npm prune --omit=dev

# Copy entrypoint
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Create data directories (overridden by volume mount in production)
RUN mkdir -p /data/brands /data/uploads /data/video-analysis

ENV NODE_ENV=production
ENV FFMPEG_PATH=ffmpeg

EXPOSE 3000

CMD ["./start.sh"]
