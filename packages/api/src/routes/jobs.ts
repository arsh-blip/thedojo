import { Router } from "express";
import { jobManager } from "../lib/job-manager.js";

const router = Router();

// List all jobs
router.get("/", (_req, res) => {
  const type = _req.query.type as string | undefined;
  const jobs = jobManager.listJobs(type);
  res.json(jobs);
});

// Get single job status
router.get("/:id", (req, res) => {
  const job = jobManager.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

// SSE stream for real-time progress
router.get("/:id/stream", (req, res) => {
  const job = jobManager.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Subscribe to updates
  jobManager.subscribe(req.params.id, res);

  // Keep-alive ping every 30s
  const interval = setInterval(() => {
    res.write(": ping\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

export { router as jobsRouter };
