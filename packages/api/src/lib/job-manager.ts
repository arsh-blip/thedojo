import { v4 as uuid } from "uuid";
import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";

export type JobStatus = "queued" | "running" | "completed" | "failed";

const JOBS_DIR = "/tmp/video-analysis";
const JOBS_FILE = path.join(JOBS_DIR, "jobs.json");
const EXPIRY_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface JobProgress {
  videosTotal: number;
  videosCompleted: number;
  framesAnalyzed: number;
  currentVideo: string;
  estimatedSecondsRemaining: number | null;
  errors: string[];
}

export interface Job {
  id: string;
  type: "batch_analysis" | "single_analysis" | "premiere_export" | "drive_pull";
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  progress: JobProgress | null;
  result: unknown | null;
  error: string | null;
  config: Record<string, unknown>;
}

class JobManager {
  private jobs = new Map<string, Job>();
  private subscribers = new Map<string, Set<Response>>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadFromDisk();
    this.purgeExpired();
  }

  createJob(type: Job["type"], config: Record<string, unknown>): Job {
    const job: Job = {
      id: uuid(),
      type,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: null,
      result: null,
      error: null,
      config,
    };
    this.jobs.set(job.id, job);
    this.scheduleSave();
    return job;
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  listJobs(type?: string): Job[] {
    this.purgeExpired();
    const all = Array.from(this.jobs.values());
    const filtered = type ? all.filter((j) => j.type === type) : all;
    return filtered.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  updateJob(id: string, update: Partial<Job>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, update, { updatedAt: new Date().toISOString() });
    this.notifySubscribers(id, job);
    this.scheduleSave();
  }

  subscribe(jobId: string, res: Response): void {
    if (!this.subscribers.has(jobId)) {
      this.subscribers.set(jobId, new Set());
    }
    this.subscribers.get(jobId)!.add(res);

    res.on("close", () => {
      this.subscribers.get(jobId)?.delete(res);
    });

    // Send current state immediately
    const job = this.jobs.get(jobId);
    if (job) {
      res.write(`data: ${JSON.stringify(job)}\n\n`);
    }
  }

  private notifySubscribers(jobId: string, job: Job): void {
    const subs = this.subscribers.get(jobId);
    if (!subs) return;
    const data = `data: ${JSON.stringify(job)}\n\n`;
    for (const res of subs) {
      try {
        res.write(data);
      } catch {
        subs.delete(res);
      }
    }
  }

  // ── Disk Persistence ─────────────────────────────────────────────

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(JOBS_FILE)) {
        const raw = fs.readFileSync(JOBS_FILE, "utf-8");
        const entries: Job[] = JSON.parse(raw);
        for (const job of entries) {
          // Mark any previously running/queued jobs as failed (server restarted)
          if (job.status === "running" || job.status === "queued") {
            job.status = "failed";
            job.error = "Server restarted while job was in progress";
            job.updatedAt = new Date().toISOString();
          }
          this.jobs.set(job.id, job);
        }
      }
    } catch {
      // Corrupted file — start fresh
    }
  }

  private saveToDisk(): void {
    try {
      fs.mkdirSync(JOBS_DIR, { recursive: true });
      const entries = Array.from(this.jobs.values());
      fs.writeFileSync(JOBS_FILE, JSON.stringify(entries, null, 2));
    } catch {
      // Non-critical — jobs will be lost on restart
    }
  }

  private scheduleSave(): void {
    // Debounce saves to avoid excessive disk writes during rapid updates
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveToDisk();
      this.saveTimer = null;
    }, 1000);
  }

  private purgeExpired(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, job] of this.jobs) {
      if (
        (job.status === "completed" || job.status === "failed") &&
        now - new Date(job.updatedAt).getTime() > EXPIRY_MS
      ) {
        this.jobs.delete(id);
        changed = true;
      }
    }
    if (changed) this.scheduleSave();
  }
}

export const jobManager = new JobManager();
