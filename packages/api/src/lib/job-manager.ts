import { v4 as uuid } from "uuid";
import type { Response } from "express";

export type JobStatus = "queued" | "running" | "completed" | "failed";

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
  type: "batch_analysis" | "single_analysis" | "premiere_export";
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
    return job;
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  listJobs(type?: string): Job[] {
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
}

export const jobManager = new JobManager();
