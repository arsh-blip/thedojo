"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VideoAnalysisSummary, BatchStats } from "@/lib/api-client";

interface Props {
  videos: VideoAnalysisSummary[];
  stats: BatchStats | null;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  }
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(2)} MB`;
  }
  if (bytes >= 1_000) {
    return `${(bytes / 1_000).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

function formatProcessingTime(ms: number): string {
  const seconds = ms / 1000;
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  return `${seconds.toFixed(1)}s`;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function VideoAnalysisOverview({ videos, stats }: Props) {
  return (
    <div className="space-y-6">
      {stats && <StatsBar stats={stats} />}

      <div className="space-y-4">
        {videos.map((video, index) => (
          <VideoCard key={`${video.metadata.fileName}-${index}`} video={video} />
        ))}
      </div>
    </div>
  );
}

function StatsBar({ stats }: { stats: BatchStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
      <Card>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">Total Videos</p>
          <p className="text-2xl font-semibold">{stats.totalVideos}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">Successful</p>
          <p className="text-2xl font-semibold">{stats.successCount}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">Frames Analyzed</p>
          <p className="text-2xl font-semibold">{stats.totalFramesAnalyzed}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">Processing Time</p>
          <p className="text-2xl font-semibold">
            {formatProcessingTime(stats.processingTimeMs)}
          </p>
        </CardContent>
      </Card>

      {stats.errorCount > 0 && (
        <Card>
          <CardContent className="pt-0">
            <p className="text-sm text-destructive">Errors</p>
            <p className="text-2xl font-semibold text-destructive">
              {stats.errorCount}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function VideoCard({ video }: { video: VideoAnalysisSummary }) {
  const [showAllFrames, setShowAllFrames] = useState(false);
  const { metadata, transcript, frameAnalyses } = video;

  const hasTranscript =
    transcript &&
    transcript.trim().length > 0 &&
    !transcript.startsWith("(transcription failed");

  const transcriptionFailed =
    transcript && transcript.startsWith("(transcription failed");

  const framesToShow = showAllFrames
    ? frameAnalyses
    : frameAnalyses.slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="font-mono">{metadata.fileName}</span>
          <span className="text-sm font-normal text-muted-foreground">
            {formatFileSize(metadata.fileSize)}
          </span>
          <Badge variant="secondary">{metadata.codec}</Badge>
          <span className="text-sm font-normal text-muted-foreground">
            {metadata.width}x{metadata.height}
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            {formatDuration(metadata.durationSeconds)}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Transcript section */}
        {hasTranscript && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Transcript</h4>
            <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/50 p-3">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {transcript}
              </p>
            </div>
          </div>
        )}

        {transcriptionFailed && (
          <Badge variant="outline" className="text-yellow-600">
            Transcription failed
          </Badge>
        )}

        {/* Frame Analysis section */}
        {frameAnalyses.length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Frame Analysis</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Timestamp</th>
                    <th className="pb-2 pr-4 font-medium">Scene Type</th>
                    <th className="pb-2 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {framesToShow.map((frame, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">
                        {formatTimestamp(frame.timestampSeconds)}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="secondary">{frame.sceneType}</Badge>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {frame.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {frameAnalyses.length > 10 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllFrames((prev) => !prev)}
              >
                {showAllFrames
                  ? "Show fewer frames"
                  : `Show all ${frameAnalyses.length} frames`}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No frames extracted</p>
        )}
      </CardContent>
    </Card>
  );
}
