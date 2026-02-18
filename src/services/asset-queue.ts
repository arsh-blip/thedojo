import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import type {
  AssetQueue,
  QueuedAsset,
  AssetAnalysisResult,
  DriveFileInfo,
} from "../types.js";
import { AssetAnalyzer } from "./asset-analyzer.js";
import { GoogleDriveService } from "./google-drive.js";

// ── Singleton queue store (persists across MCP tool calls in a session) ──

const queues = new Map<string, AssetQueue>();
const analyzer = new AssetAnalyzer();

// Known creative asset extensions to scan for
const CREATIVE_EXTENSIONS = new Set([
  ".mp4", ".mov", ".avi", ".wmv", ".webm", ".mkv",
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif",
  ".mp3", ".wav", ".aac", ".ogg", ".flac",
  ".pdf", ".psd", ".ai", ".svg",
]);

function isCreativeAsset(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return CREATIVE_EXTENSIONS.has(ext);
}

// ── Queue creation ──────────────────────────────────────────────────

/**
 * Scan a local folder and create a processing queue from all creative assets found.
 */
export async function scanLocalFolder(
  folderPath: string,
  batchSize: number = 2,
  queueName?: string
): Promise<AssetQueue> {
  const resolvedPath = path.resolve(folderPath);
  const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

  const assets: QueuedAsset[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isCreativeAsset(entry.name)) continue;

    const fullPath = path.join(resolvedPath, entry.name);

    let fileSize: number | undefined;
    try {
      const stat = await fs.stat(fullPath);
      fileSize = stat.size;
    } catch {
      // skip files we can't stat
      continue;
    }

    assets.push({
      id: randomUUID(),
      source: "local",
      sourcePath: fullPath,
      filename: entry.name,
      mimeType: "", // will be resolved during analysis
      fileSize,
      status: "pending",
      queuedAt: new Date().toISOString(),
    });
  }

  const queue: AssetQueue = {
    id: randomUUID(),
    name: queueName || path.basename(resolvedPath),
    source: "local",
    sourcePath: resolvedPath,
    batchSize,
    totalAssets: assets.length,
    assets,
    createdAt: new Date().toISOString(),
    status: "idle",
  };

  queues.set(queue.id, queue);
  return queue;
}

/**
 * Scan a Google Drive folder and create a processing queue.
 */
export async function scanDriveFolder(
  driveService: GoogleDriveService,
  folderId: string,
  batchSize: number = 2,
  queueName?: string
): Promise<AssetQueue> {
  const files = await driveService.listFolderContents(folderId);

  const assets: QueuedAsset[] = files.map(
    (file: DriveFileInfo): QueuedAsset => ({
      id: randomUUID(),
      source: "google_drive",
      sourcePath: file.id,
      filename: file.name,
      mimeType: file.mimeType,
      fileSize: file.size,
      status: "pending",
      queuedAt: new Date().toISOString(),
    })
  );

  const queue: AssetQueue = {
    id: randomUUID(),
    name: queueName || `drive-folder-${folderId.slice(0, 8)}`,
    source: "google_drive",
    sourcePath: folderId,
    batchSize,
    totalAssets: assets.length,
    assets,
    createdAt: new Date().toISOString(),
    status: "idle",
  };

  queues.set(queue.id, queue);
  return queue;
}

// ── Batch processing ────────────────────────────────────────────────

/**
 * Process the next batch of pending assets in the queue.
 * Returns the analysis results for the batch, or null if the queue is done.
 */
export async function processNextBatch(
  queueId: string,
  driveService?: GoogleDriveService
): Promise<{
  batchResults: AssetAnalysisResult[];
  remaining: number;
  queueComplete: boolean;
} | null> {
  const queue = queues.get(queueId);
  if (!queue) return null;

  const pending = queue.assets.filter((a) => a.status === "pending");
  if (pending.length === 0) {
    queue.status = "completed";
    return { batchResults: [], remaining: 0, queueComplete: true };
  }

  queue.status = "processing";
  const batch = pending.slice(0, queue.batchSize);
  const batchResults: AssetAnalysisResult[] = [];

  for (const asset of batch) {
    asset.status = "processing";

    try {
      let result: AssetAnalysisResult;

      if (asset.source === "local") {
        result = await analyzer.analyzeLocalFile(asset.sourcePath, asset.id);
      } else {
        // For Drive files, analyze from metadata
        result = analyzer.analyzeFromDriveMetadata(
          asset.sourcePath,
          asset.filename,
          asset.mimeType,
          asset.fileSize || 0,
          asset.id
        );
      }

      asset.status = "completed";
      asset.analysisResult = result;
      asset.mimeType = result.mimeType;
      asset.processedAt = new Date().toISOString();
      batchResults.push(result);
    } catch (err) {
      asset.status = "failed";
      asset.error = err instanceof Error ? err.message : String(err);
      asset.processedAt = new Date().toISOString();
    }
  }

  const remaining = queue.assets.filter((a) => a.status === "pending").length;
  const queueComplete = remaining === 0;
  if (queueComplete) queue.status = "completed";

  return { batchResults, remaining, queueComplete };
}

// ── Queue introspection ─────────────────────────────────────────────

export function getQueue(queueId: string): AssetQueue | undefined {
  return queues.get(queueId);
}

export function getQueueStatus(queueId: string): {
  found: boolean;
  id: string;
  name: string;
  status: string;
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  batchSize: number;
} | null {
  const queue = queues.get(queueId);
  if (!queue) return null;

  return {
    found: true,
    id: queue.id,
    name: queue.name,
    status: queue.status,
    total: queue.totalAssets,
    pending: queue.assets.filter((a) => a.status === "pending").length,
    processing: queue.assets.filter((a) => a.status === "processing").length,
    completed: queue.assets.filter((a) => a.status === "completed").length,
    failed: queue.assets.filter((a) => a.status === "failed").length,
    batchSize: queue.batchSize,
  };
}

export function getAnalysisResults(
  queueId: string
): AssetAnalysisResult[] | null {
  const queue = queues.get(queueId);
  if (!queue) return null;

  return queue.assets
    .filter((a) => a.status === "completed" && a.analysisResult)
    .map((a) => a.analysisResult!);
}

export function listQueues(): {
  id: string;
  name: string;
  status: string;
  total: number;
  completed: number;
}[] {
  return Array.from(queues.values()).map((q) => ({
    id: q.id,
    name: q.name,
    status: q.status,
    total: q.totalAssets,
    completed: q.assets.filter((a) => a.status === "completed").length,
  }));
}
