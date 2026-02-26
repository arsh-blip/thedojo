"use client";

import { useEffect, useState } from "react";
import { useSSE } from "@/lib/use-sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, HardDriveDownload, Loader2 } from "lucide-react";

interface DriveVideoProgressProps {
  jobId: string;
  onComplete: () => void;
}

interface JobData {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  updatedAt?: string;
  progress?: {
    videosTotal: number;
    videosCompleted: number;
    currentVideo: string;
    estimatedSecondsRemaining: number | null;
    errors: string[];
  };
  error?: string;
}

export function DriveVideoProgress({ jobId, onComplete }: DriveVideoProgressProps) {
  const [job, setJob] = useState<JobData | null>(null);
  const [autoAdvanced, setAutoAdvanced] = useState(false);

  useSSE<JobData>({
    url: `/api/jobs/${jobId}/stream`,
    onMessage: (data) => {
      setJob(data);
    },
  });

  // Auto-advance to analyze tab when download completes
  useEffect(() => {
    if (job?.status === "completed" && !autoAdvanced) {
      setAutoAdvanced(true);
      const timer = setTimeout(() => onComplete(), 1500);
      return () => clearTimeout(timer);
    }
  }, [job?.status, onComplete, autoAdvanced]);

  const progress = job?.progress;
  const pct =
    progress && progress.videosTotal > 0
      ? Math.round((progress.videosCompleted / progress.videosTotal) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDriveDownload className="size-5" />
          Downloading Videos from Google Drive
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!job || job.status === "queued" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Preparing download...
          </div>
        ) : job.status === "running" ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground truncate max-w-[70%]">
                  {progress?.currentVideo || "Downloading..."}
                </span>
                <Badge variant="secondary">
                  {progress?.videosCompleted || 0} / {progress?.videosTotal || 0}
                </Badge>
              </div>
              {progress?.estimatedSecondsRemaining != null && progress.estimatedSecondsRemaining > 0 && (
                <p className="text-xs text-muted-foreground">
                  ~{formatEta(progress.estimatedSecondsRemaining)} remaining
                </p>
              )}
            </div>
            <Progress value={pct} />
            {progress?.errors && progress.errors.length > 0 && (
              <div className="space-y-1">
                {progress.errors.map((err, i) => (
                  <p key={i} className="text-xs text-destructive">
                    {err}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : job.status === "completed" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="size-4" />
              {progress?.currentVideo || `Downloaded ${progress?.videosCompleted || 0} video(s) successfully`}
            </div>
            <Progress value={100} />
            {progress?.errors && progress.errors.length > 0 && (
              <div className="space-y-1 rounded-md bg-destructive/10 p-2">
                <p className="text-xs font-medium text-destructive">{progress.errors.length} file(s) failed:</p>
                {progress.errors.map((err, i) => (
                  <p key={i} className="text-xs text-destructive">{err}</p>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Redirecting to analysis...
            </p>
            <Button onClick={onComplete} className="w-full">
              Continue to Analysis
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="size-4" />
              {job.error || "Download failed"}
            </div>
            {progress?.errors && progress.errors.length > 0 && (
              <div className="space-y-1">
                {progress.errors.map((err, i) => (
                  <p key={i} className="text-xs text-destructive">
                    {err}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
