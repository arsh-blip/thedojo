"use client";

import { useSSE } from "@/lib/use-sse";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Clock, Film, Layers } from "lucide-react";

interface JobSSEData {
  id: string;
  status: string;
  progress?: {
    videosTotal: number;
    videosCompleted: number;
    framesAnalyzed: number;
    currentVideo: string;
    estimatedSecondsRemaining: number;
    errors: string[];
  };
}

interface ProgressTrackerProps {
  jobId: string | null;
  onComplete?: (jobId: string) => void;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "running":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

export function ProgressTracker({ jobId, onComplete }: ProgressTrackerProps) {
  const { data, error, connected } = useSSE<JobSSEData>({
    url: jobId ? `/api/jobs/${jobId}/stream` : null,
    onMessage: (msg) => {
      if (msg.status === "completed" && onComplete) {
        onComplete(msg.id);
      }
    },
  });

  if (!jobId) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
        <p className="text-sm">Start an analysis to track progress here.</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-destructive">
        <AlertCircle className="size-6" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
        <p className="text-sm">
          {connected ? "Waiting for data..." : "Connecting..."}
        </p>
      </div>
    );
  }

  const progress = data.progress;
  const percent =
    progress && progress.videosTotal > 0
      ? Math.round((progress.videosCompleted / progress.videosTotal) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Job: </span>
          <code className="rounded bg-muted px-2 py-0.5 text-xs font-mono">
            {data.id}
          </code>
        </div>
        <Badge variant={statusVariant(data.status)}>
          {data.status === "completed" && <CheckCircle2 className="size-3" />}
          {data.status}
        </Badge>
      </div>

      {progress && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>
                {progress.videosCompleted} / {progress.videosTotal} videos
              </span>
              <span className="font-medium">{percent}%</span>
            </div>
            <Progress value={percent} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Film className="size-4 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground">Current Video</p>
                <p className="font-medium truncate">{progress.currentVideo || "---"}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <Layers className="size-4 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground">Frames Analyzed</p>
                <p className="font-medium">
                  {progress.framesAnalyzed.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <Clock className="size-4 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground">ETA</p>
                <p className="font-medium">
                  {progress.estimatedSecondsRemaining > 0
                    ? formatEta(progress.estimatedSecondsRemaining)
                    : "---"}
                </p>
              </div>
            </div>
          </div>

          {progress.errors.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-destructive">
                Errors ({progress.errors.length})
              </p>
              <ul className="space-y-1">
                {progress.errors.map((err, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                  >
                    <AlertCircle className="mt-0.5 size-3 shrink-0" />
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
