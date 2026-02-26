import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { upload } from "../middleware/upload.js";
import { jobManager } from "../lib/job-manager.js";
import {
  getVideoService,
  getPremiereService,
  getDriveService,
} from "../lib/service-factory.js";
import * as store from "../lib/library-store.js";
import type { VideoAnalysisResult } from "@thedojo/services";

const router = Router();

// Upload video files
router.post("/upload", upload.array("files", 200), (req, res) => {
  const uploadId = (req as any).uploadId;
  const files = (req.files as Express.Multer.File[]) || [];
  res.json({
    uploadId,
    files: files.map((f) => ({
      name: f.originalname,
      path: f.path,
      size: f.size,
    })),
  });
});

// Start batch analysis
router.post("/batch", async (req, res) => {
  const { uploadId, brandContext, brandSlug, frameDetail } = req.body;
  const uploadDir = `/tmp/uploads/${uploadId}`;

  if (!uploadId || !fs.existsSync(uploadDir)) {
    res.status(400).json({ error: "Invalid uploadId or upload directory not found" });
    return;
  }

  // Resolve brand context: explicit brandContext takes priority,
  // otherwise auto-fetch from linked messaging doc
  let resolvedBrandContext = brandContext;
  if (!resolvedBrandContext && brandSlug) {
    const brand = store.getBrand(brandSlug);
    if (brand?.messagingDocId) {
      try {
        const driveService = getDriveService();
        resolvedBrandContext = await driveService.getDocumentContent(brand.messagingDocId);
      } catch (err) {
        console.error(`Failed to fetch messaging doc for ${brandSlug}:`, err);
      }
    }
  }

  const job = jobManager.createJob("batch_analysis", {
    uploadId,
    brandContext: resolvedBrandContext,
    brandSlug,
    frameDetail,
  });

  // Return immediately with job ID
  res.json({ jobId: job.id });

  // Run analysis in background
  runBatchAnalysis(job.id, uploadDir, resolvedBrandContext).catch((err) => {
    jobManager.updateJob(job.id, {
      status: "failed",
      error: err.message,
    });
  });
});

// Get batch results
router.get("/batch/:jobId/results", async (req, res) => {
  const job = jobManager.getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "completed") {
    res.status(202).json({ status: job.status, message: "Job not yet completed" });
    return;
  }
  const resultPath = (job.result as any)?.resultPath;
  if (!resultPath || !fs.existsSync(resultPath)) {
    res.status(404).json({ error: "Results file not found" });
    return;
  }
  const data = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
  res.json(data);
});

// Pull selects
router.post("/selects", async (req, res, next) => {
  try {
    const { analysisPath, sceneTypes, minScore, topN, minDuration, basePath } =
      req.body;
    const analyses = loadAnalyses(analysisPath);
    const service = getPremiereService();
    const selects = service.pullSelects(analyses, {
      sceneTypes,
      minScore: minScore ?? 30,
      topN: topN ?? 10,
      minDurationSeconds: minDuration ?? 1.0,
      basePath,
    });
    res.json(selects);
  } catch (err) {
    next(err);
  }
});

// Build bins
router.post("/bins", async (req, res, next) => {
  try {
    const { analysisPath, minScore, basePath } = req.body;
    const analyses = loadAnalyses(analysisPath);
    const service = getPremiereService();
    const selects = service.pullSelects(analyses, {
      minScore: minScore ?? 30,
      basePath,
    });
    const bins = service.buildBins(selects);
    res.json(bins);
  } catch (err) {
    next(err);
  }
});

// Assemble rough cut
router.post("/rough-cut", async (req, res, next) => {
  try {
    const { analysisPath, templateName, fps, minScore, basePath } = req.body;
    const analyses = loadAnalyses(analysisPath);
    const service = getPremiereService();
    const selects = service.pullSelects(analyses, {
      minScore: minScore ?? 30,
      basePath,
    });
    const bins = service.buildBins(selects);
    const template = service
      .getTemplates()
      .find((t) => t.name === (templateName || "Standard Performance Ad (30s)"));
    if (!template) {
      res.status(400).json({ error: "Invalid template name" });
      return;
    }
    const roughCut = service.assembleRoughCut(bins, template, {
      fps: fps ?? 30,
    });
    res.json(roughCut);
  } catch (err) {
    next(err);
  }
});

// Export Premiere XML (download)
router.post("/export/premiere", async (req, res, next) => {
  try {
    const {
      analysisPath,
      projectName,
      templateName,
      fps,
      resolutionWidth,
      resolutionHeight,
      minScore,
      basePath,
    } = req.body;

    const service = getPremiereService();
    const outputPath = `/tmp/video-analysis/export_${Date.now()}.xml`;

    const resolvedPath = resolveAnalysisPath(analysisPath);
    const exportData = await service.generatePremiereProject(
      resolvedPath,
      outputPath,
      {
        projectName: projectName || "AI Rough Cut",
        templateName:
          templateName || "Standard Performance Ad (30s)",
        fps: fps ?? 30,
        resolution: {
          width: resolutionWidth ?? 1080,
          height: resolutionHeight ?? 1920,
        },
        minScore: minScore ?? 30,
        basePath,
      }
    );

    res.setHeader("Content-Type", "application/xml");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(projectName || "premiere-export").replace(/[^a-zA-Z0-9-_ ]/g, "")}.xml"`
    );

    const xml = fs.readFileSync(outputPath, "utf-8");
    res.send(xml);

    // Cleanup temp file
    fs.unlinkSync(outputPath);
  } catch (err) {
    next(err);
  }
});

// Export CSV (download)
router.post("/export/csv", async (req, res, next) => {
  try {
    const { analysisPath } = req.body;
    const resolvedPath = resolveAnalysisPath(analysisPath);
    const raw = fs.readFileSync(resolvedPath, "utf-8");
    const data = JSON.parse(raw);
    const rows = data.creativeStrategy || [];

    const headers = [
      "Naming Convention", "Priority", "Persona", "Angle", "Sub-Angles",
      "Primary Benefits", "Description", "Emotional Fear", "Problem>Solution>Promise",
      "Before / After Frameworks", "Example Headline", "Example Testimonial",
      "Example UGC Hook", "Key Points / Framing", "Objections",
    ];
    const csvRows = rows.map((r: any) =>
      [
        r.namingConvention, r.priority, r.persona, r.angle, r.subAngles,
        r.primaryBenefits, r.description, r.emotionalFear, r.problemSolutionPromise,
        r.beforeAfterFrameworks, r.exampleHeadline, r.exampleTestimonial,
        r.exampleUGCHook, r.keyPointsFraming, r.objections,
      ]
        .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [headers.join(","), ...csvRows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="creative-strategy.csv"'
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// Get full batch summary (creative strategy + per-video analysis data)
router.post("/batch-summary", async (req, res, next) => {
  try {
    const { analysisPath } = req.body;
    const resolvedPath = resolveAnalysisPath(analysisPath);
    const raw = fs.readFileSync(resolvedPath, "utf-8");
    const data = JSON.parse(raw);
    res.json({
      creativeStrategy: data.creativeStrategy || [],
      videoAnalyses: (data.videoAnalyses || []).map((v: any) => ({
        metadata: v.metadata,
        frameCount: v.frameAnalyses?.length || 0,
        transcript: v.transcript || "",
        narrativeStructure: v.narrativeStructure || null,
        frameAnalyses: v.frameAnalyses || [],
      })),
      stats: data.stats || null,
    });
  } catch (err) {
    next(err);
  }
});

// List narrative templates
router.get("/templates", (_req, res) => {
  const service = getPremiereService();
  res.json(service.getTemplates());
});

// ── Background batch analysis ────────────────────────────────────────

async function runBatchAnalysis(
  jobId: string,
  folderPath: string,
  brandContext?: string
) {
  const videoService = getVideoService();

  jobManager.updateJob(jobId, { status: "running" });

  // Discover video files
  const videoFiles = await discoverVideos(folderPath);
  const startTime = Date.now();
  const analyses: VideoAnalysisResult[] = [];
  const errors: string[] = [];
  let totalFrames = 0;

  // Load drive manifest if it exists (maps relativePath → Drive metadata)
  let driveManifest: Record<string, { driveFileId: string; driveWebViewLink?: string }> = {};
  const manifestPath = path.join(folderPath, "drive-manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      driveManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
      // Ignore malformed manifest
    }
  }

  for (let i = 0; i < videoFiles.length; i++) {
    const file = videoFiles[i];
    const elapsed = Date.now() - startTime;
    const avgPerVideo = i > 0 ? elapsed / i : 30000;
    const remaining = (videoFiles.length - i) * avgPerVideo;

    jobManager.updateJob(jobId, {
      progress: {
        videosTotal: videoFiles.length,
        videosCompleted: i,
        framesAnalyzed: totalFrames,
        currentVideo: path.basename(file),
        estimatedSecondsRemaining: Math.round(remaining / 1000),
        errors,
      },
    });

    try {
      const result = await videoService.analyzeVideo(file);

      // Inject Drive metadata if available
      const relativePath = path.relative(folderPath, file);
      const driveInfo = driveManifest[relativePath];
      if (driveInfo) {
        result.metadata.driveFileId = driveInfo.driveFileId;
        result.metadata.driveWebViewLink = driveInfo.driveWebViewLink;
      }

      analyses.push(result);
      totalFrames += result.frameAnalyses.length;
    } catch (err: any) {
      errors.push(`${path.basename(file)}: ${err.message}`);
    }

    // Rate limit between videos
    if (i < videoFiles.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Synthesize creative strategy
  const creativeStrategy = await videoService.synthesizeCreativeStrategy(
    analyses,
    brandContext
  );

  // Save results
  const resultPath = `/tmp/video-analysis/batch_${jobId}.json`;
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });

  const batchResult = {
    videoAnalyses: analyses,
    creativeStrategy,
    stats: {
      totalVideos: videoFiles.length,
      successCount: analyses.length,
      errorCount: errors.length,
      totalFramesAnalyzed: totalFrames,
      estimatedCost:
        totalFrames * 0.0002 + analyses.length * 2 * 0.006 + analyses.length * 0.01,
      processingTimeMs: Date.now() - startTime,
    },
  };

  fs.writeFileSync(resultPath, JSON.stringify(batchResult, null, 2));

  jobManager.updateJob(jobId, {
    status: "completed",
    result: { resultPath, stats: batchResult.stats },
    progress: {
      videosTotal: videoFiles.length,
      videosCompleted: videoFiles.length,
      framesAnalyzed: totalFrames,
      currentVideo: "Done",
      estimatedSecondsRemaining: 0,
      errors,
    },
  });
}

async function discoverVideos(folderPath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.promises.readdir(folderPath, {
    withFileTypes: true,
  });
  for (const entry of entries) {
    const full = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await discoverVideos(full)));
    } else if (/\.(mp4|mov)$/i.test(entry.name)) {
      results.push(full);
    }
  }
  return results.sort();
}

function resolveAnalysisPath(analysisPathOrJobId: string): string {
  // If it looks like a file path and exists, use it directly
  if (analysisPathOrJobId.startsWith("/") && fs.existsSync(analysisPathOrJobId)) {
    return analysisPathOrJobId;
  }
  // Otherwise treat it as a job ID and resolve from the job's result
  const job = jobManager.getJob(analysisPathOrJobId);
  if (job?.result) {
    const resultPath = (job.result as any).resultPath;
    if (resultPath && fs.existsSync(resultPath)) {
      return resultPath;
    }
  }
  // Last resort: try the conventional path
  const conventionalPath = `/tmp/video-analysis/batch_${analysisPathOrJobId}.json`;
  if (fs.existsSync(conventionalPath)) {
    return conventionalPath;
  }
  throw new Error(`Analysis results not found for: ${analysisPathOrJobId}`);
}

function loadAnalyses(analysisPathOrJobId: string): VideoAnalysisResult[] {
  const filePath = resolveAnalysisPath(analysisPathOrJobId);
  const raw = fs.readFileSync(filePath, "utf-8");
  const batch = JSON.parse(raw);
  return batch.videoAnalyses || batch;
}

export { router as videoRouter };
