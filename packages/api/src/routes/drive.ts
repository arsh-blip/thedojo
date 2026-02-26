import { Router } from "express";
import { getDriveService } from "../lib/service-factory.js";
import { jobManager } from "../lib/job-manager.js";
import { v4 as uuid } from "uuid";
import path from "node:path";
import fs from "node:fs";

const router = Router();

// List folder contents
router.get("/folder{/:folderId}", async (req, res, next) => {
  try {
    const drive = getDriveService();
    const folderId =
      (req.params as any).folderId || "1ttQlzxwqEqvt3keHwKAcXn33TnkT5bos";
    const items = await drive.listFolder(folderId);
    const metadata = await drive.getFileMetadata(folderId);
    res.json({ folder: metadata, items });
  } catch (err) {
    next(err);
  }
});

// Get file metadata + content
router.get("/file/:fileId", async (req, res, next) => {
  try {
    const drive = getDriveService();
    const metadata = await drive.getFileMetadata(req.params.fileId);
    const content = await drive.getDocumentContent(req.params.fileId);
    res.json({ metadata, content });
  } catch (err) {
    next(err);
  }
});

// Create folder
router.post("/folder", async (req, res, next) => {
  try {
    const drive = getDriveService();
    const { name, parentId } = req.body;
    if (!name || !parentId) {
      res.status(400).json({ error: "name and parentId are required" });
      return;
    }
    const folder = await drive.createFolder(name, parentId);
    res.json(folder);
  } catch (err) {
    next(err);
  }
});

// Setup client folder structure
router.post("/client-structure", async (req, res, next) => {
  try {
    const drive = getDriveService();
    const { clientName, rootId } = req.body;
    if (!clientName) {
      res.status(400).json({ error: "clientName is required" });
      return;
    }
    const result = await drive.createClientFolderStructure(
      clientName,
      rootId || "1ttQlzxwqEqvt3keHwKAcXn33TnkT5bos"
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Search files
router.get("/search", async (req, res, next) => {
  try {
    const drive = getDriveService();
    const q = req.query.q as string;
    const parentId = req.query.parentId as string | undefined;
    if (!q) {
      res.status(400).json({ error: "q (query) is required" });
      return;
    }
    const files = await drive.searchFiles(q, parentId);
    res.json(files);
  } catch (err) {
    next(err);
  }
});

// Create presentation
router.post("/presentation", async (req, res, next) => {
  try {
    const drive = getDriveService();
    const { name, folderId, templateId } = req.body;
    if (!name || !folderId) {
      res.status(400).json({ error: "name and folderId are required" });
      return;
    }
    let file;
    if (templateId) {
      file = await drive.copyFile(templateId, name, folderId);
    } else {
      file = await drive.createPresentation(name, folderId);
    }
    res.json(file);
  } catch (err) {
    next(err);
  }
});

// Pull videos from a Drive folder (recursive) — downloads to local disk for analysis
router.post("/pull-videos", async (req, res, next) => {
  try {
    const driveService = getDriveService();
    const { folderId } = req.body;
    if (!folderId) {
      res.status(400).json({ error: "folderId is required" });
      return;
    }

    const uploadId = uuid();
    const destDir = `/tmp/uploads/${uploadId}`;
    const CONCURRENCY = 2;

    // Create job to track progress
    const job = jobManager.createJob("drive_pull", { folderId, uploadId });

    // Return immediately with jobId and uploadId
    res.json({ jobId: job.id, uploadId });

    // Run the discovery + download in the background
    (async () => {
      try {
        jobManager.updateJob(job.id, {
          status: "running",
          progress: {
            videosTotal: 0,
            videosCompleted: 0,
            framesAnalyzed: 0,
            currentVideo: "Scanning folders...",
            estimatedSecondsRemaining: null,
            errors: [],
          },
        });

        // Discover all files recursively
        const allFiles = await driveService.listFolderRecursive(folderId);

        // Filter for video files only
        const videoFiles = allFiles.filter((f) => {
          const ext = path.extname(f.name).toLowerCase();
          return [".mp4", ".mov"].includes(ext);
        });

        if (videoFiles.length === 0) {
          jobManager.updateJob(job.id, {
            status: "failed",
            error: "No .mp4 or .mov files found in the selected folder or its subfolders",
          });
          return;
        }

        // Fetch file sizes concurrently for progress reporting
        const fileSizes = await Promise.all(
          videoFiles.map((f) => driveService.getFileSize(f.id))
        );
        const totalBytes = fileSizes.reduce((a, b) => a + b, 0);

        jobManager.updateJob(job.id, {
          progress: {
            videosTotal: videoFiles.length,
            videosCompleted: 0,
            framesAnalyzed: 0,
            currentVideo: `Found ${videoFiles.length} video(s)${totalBytes > 0 ? ` (${formatBytes(totalBytes)})` : ""}. Starting download...`,
            estimatedSecondsRemaining: null,
            errors: [],
          },
        });

        const downloadedFiles: { name: string; path: string; size: number }[] = [];
        const errors: string[] = [];
        let completedCount = 0;
        let bytesDownloaded = 0;
        const activeDownloads: string[] = [];
        const startTime = Date.now();

        // Throttle progress updates to avoid flooding SSE (max every 500ms)
        let lastProgressUpdate = 0;
        function emitProgress(force = false) {
          const now = Date.now();
          if (!force && now - lastProgressUpdate < 500) return;
          lastProgressUpdate = now;

          const elapsed = (Date.now() - startTime) / 1000;
          const rate = bytesDownloaded / (elapsed || 1);
          const remaining = totalBytes > 0 ? Math.round((totalBytes - bytesDownloaded) / rate) : null;

          const status = activeDownloads.length > 0
            ? `Downloading: ${activeDownloads.join(", ")}`
            : `${completedCount}/${videoFiles.length} complete`;

          jobManager.updateJob(job.id, {
            progress: {
              videosTotal: videoFiles.length,
              videosCompleted: completedCount,
              framesAnalyzed: 0,
              currentVideo: `${status}${totalBytes > 0 ? ` — ${formatBytes(bytesDownloaded)}/${formatBytes(totalBytes)}` : ""}`,
              estimatedSecondsRemaining: remaining,
              errors: [...errors],
            },
          });
        }

        // Download files with bounded concurrency
        let fileIndex = 0;
        async function downloadNext(): Promise<void> {
          while (fileIndex < videoFiles.length) {
            const idx = fileIndex++;
            const file = videoFiles[idx];
            const fileDest = path.join(destDir, file.relativePath);
            const shortName = file.relativePath.split("/").pop() || file.relativePath;

            activeDownloads.push(shortName);
            emitProgress(true);

            try {
              await driveService.downloadFile(file.id, fileDest, {
                stallTimeout: 3 * 60 * 1000, // 3 min stall timeout
                onProgress: (bytes) => {
                  bytesDownloaded += bytes - (fileBytesTracked.get(idx) || 0);
                  fileBytesTracked.set(idx, bytes);
                  emitProgress();
                },
              });
              const stats = (await import("node:fs")).statSync(fileDest);
              downloadedFiles.push({
                name: file.relativePath,
                path: fileDest,
                size: stats.size,
              });
            } catch (err) {
              const msg = `Failed: ${file.relativePath} — ${err instanceof Error ? err.message : String(err)}`;
              errors.push(msg);
            }

            const dlIdx = activeDownloads.indexOf(shortName);
            if (dlIdx !== -1) activeDownloads.splice(dlIdx, 1);
            completedCount++;
            emitProgress(true);
          }
        }

        const fileBytesTracked = new Map<number, number>();
        const workers = Array.from({ length: Math.min(CONCURRENCY, videoFiles.length) }, () => downloadNext());
        await Promise.all(workers);

        if (downloadedFiles.length === 0) {
          jobManager.updateJob(job.id, {
            status: "failed",
            error: "All downloads failed",
            progress: {
              videosTotal: videoFiles.length,
              videosCompleted: 0,
              framesAnalyzed: 0,
              currentVideo: "",
              estimatedSecondsRemaining: null,
              errors,
            },
          });
          return;
        }

        // Write drive-manifest.json mapping relativePath → Drive metadata
        const driveManifest: Record<string, { driveFileId: string; driveWebViewLink?: string }> = {};
        for (const file of videoFiles) {
          driveManifest[file.relativePath] = {
            driveFileId: file.id,
            driveWebViewLink: file.webViewLink,
          };
        }
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(
          path.join(destDir, "drive-manifest.json"),
          JSON.stringify(driveManifest, null, 2)
        );

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        jobManager.updateJob(job.id, {
          status: "completed",
          result: { uploadId, files: downloadedFiles },
          progress: {
            videosTotal: videoFiles.length,
            videosCompleted: downloadedFiles.length,
            framesAnalyzed: 0,
            currentVideo: `Done — ${downloadedFiles.length} file(s) downloaded in ${elapsed}s`,
            estimatedSecondsRemaining: 0,
            errors,
          },
        });
      } catch (err) {
        jobManager.updateJob(job.id, {
          status: "failed",
          error: err instanceof Error ? err.message : "Pull failed",
        });
      }
    })();
  } catch (err) {
    next(err);
  }
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export { router as driveRouter };
