import * as crypto from "crypto";

export type VideoSource =
  | { type: "url"; url: string }
  | { type: "google_drive"; file_id: string }
  | { type: "local"; local_path: string };

export type QueueItemStatus =
  | "queued"
  | "ingesting"
  | "analyzing"
  | "completed"
  | "failed";

export interface QueueItem {
  id: string;
  source: VideoSource;
  status: QueueItemStatus;
  videoId?: string;
  error?: string;
  result?: BatchItemResult;
}

export interface BatchItemResult {
  videoId: string;
  /** MCP content blocks (text + image) from analysis */
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
}

export interface BatchJob {
  id: string;
  items: QueueItem[];
  concurrency: number;
  createdAt: Date;
  completedAt?: Date;
}

const batchStore = new Map<string, BatchJob>();

export function getBatchJob(batchId: string): BatchJob | undefined {
  return batchStore.get(batchId);
}

/**
 * Run an array of async tasks with a concurrency limit.
 * Processes items in batches — waits for a full batch to finish
 * before starting the next, so we never exceed `limit` concurrent tasks.
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    await Promise.all(batch.map(fn));
  }
}

export interface BatchProcessorDeps {
  ingestVideo: (source: VideoSource) => Promise<{ videoId: string }>;
  analyzeVideo: (videoId: string) => Promise<BatchItemResult>;
}

/**
 * Create a batch job and process all videos with a concurrency limit.
 * Returns the completed batch with all results (or errors per item).
 */
export async function processBatch(
  sources: VideoSource[],
  deps: BatchProcessorDeps,
  concurrency: number = 3
): Promise<BatchJob> {
  const batchId = crypto.randomUUID();
  const items: QueueItem[] = sources.map((source) => ({
    id: crypto.randomUUID(),
    source,
    status: "queued" as QueueItemStatus,
  }));

  const batch: BatchJob = {
    id: batchId,
    items,
    concurrency,
    createdAt: new Date(),
  };
  batchStore.set(batchId, batch);

  await runWithConcurrency(items, concurrency, async (item) => {
    try {
      // Ingest
      item.status = "ingesting";
      const { videoId } = await deps.ingestVideo(item.source);
      item.videoId = videoId;

      // Analyze
      item.status = "analyzing";
      item.result = await deps.analyzeVideo(videoId);
      item.status = "completed";
    } catch (err) {
      item.status = "failed";
      item.error = err instanceof Error ? err.message : String(err);
    }
  });

  batch.completedAt = new Date();
  return batch;
}
