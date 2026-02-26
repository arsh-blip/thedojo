# ── Build stage ────────────────────────────────────────────────────
FROM node:20-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files for dependency install (workspace-aware)
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/services/package.json ./packages/services/
COPY packages/api/package.json ./packages/api/
COPY packages/web/package.json ./packages/web/
COPY packages/mcp-server/package.json ./packages/mcp-server/

RUN npm ci

# Copy source
COPY packages/services/ ./packages/services/
COPY packages/api/ ./packages/api/
COPY packages/web/ ./packages/web/
COPY packages/mcp-server/ ./packages/mcp-server/

# Build in dependency order
RUN npm run build -w packages/services
RUN npm run build -w packages/api
RUN npm run build -w packages/web

# ── Production stage ──────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json ./
COPY packages/services/package.json ./packages/services/
COPY packages/api/package.json ./packages/api/
COPY packages/web/package.json ./packages/web/
COPY packages/mcp-server/package.json ./packages/mcp-server/

RUN npm ci --omit=dev

# Copy built artifacts from build stage
COPY --from=build /app/packages/services/dist ./packages/services/dist
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/web/.next ./packages/web/.next
COPY --from=build /app/packages/web/public ./packages/web/public
COPY --from=build /app/packages/web/next.config.ts ./packages/web/next.config.ts
COPY --from=build /app/packages/web/package.json ./packages/web/package.json

# Copy entrypoint
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Create data directories (overridden by volume mount in production)
RUN mkdir -p /data/brands /data/uploads /data/video-analysis

ENV NODE_ENV=production
ENV FFMPEG_PATH=ffmpeg

EXPOSE 3000

CMD ["./start.sh"]
