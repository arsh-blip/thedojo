"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/layout/header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressTracker } from "@/components/video/progress-tracker";
import { SelectsTable, mapApiSelects } from "@/components/video/selects-table";
import { BinsViewer, mapApiBins } from "@/components/video/bins-viewer";
import { RoughCutTimeline, mapApiRoughCut } from "@/components/video/rough-cut-timeline";
import { ExportButtons } from "@/components/video/export-buttons";
import { SaveToLibrary } from "@/components/video/save-to-library";
import { CreativeStrategyView } from "@/components/video/creative-strategy-view";
import { VideoAnalysisOverview } from "@/components/video/video-analysis-summary";
import { jobs, video } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  FileVideo,
  HardDriveDownload,
  Play,
  CheckCircle2,
} from "lucide-react";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function JobResultsPage() {
  const params = useParams<{ jobId: string }>();
  const router = useRouter();
  const jobId = params.jobId;

  const [resultsSubTab, setResultsSubTab] = useState("overview");
  const [completedFromSSE, setCompletedFromSSE] = useState(false);

  const {
    data: job,
    isLoading: jobLoading,
    refetch: refetchJob,
  } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => jobs.get(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "running" || status === "queued") return 5000;
      return false;
    },
  });

  const isRunning =
    !completedFromSSE &&
    (job?.status === "running" || job?.status === "queued");
  const isCompleted = completedFromSSE || job?.status === "completed";
  const isFailed = job?.status === "failed";
  const isBatchAnalysis = job?.type === "batch_analysis";
  const isDrivePull = job?.type === "drive_pull";
  const analysisPath = isCompleted && isBatchAnalysis ? jobId : null;

  const handleJobComplete = () => {
    setCompletedFromSSE(true);
    refetchJob();
  };

  // Drive pull result data
  const pullResult = isDrivePull && isCompleted ? (job?.result as any) : null;
  const downloadedFiles: { name: string; path: string; size: number }[] =
    pullResult?.files || [];
  const uploadId: string | null = pullResult?.uploadId || null;

  // Batch summary (creative strategy + video analysis data)
  const {
    data: batchSummary,
    isLoading: summaryLoading,
  } = useQuery({
    queryKey: ["video", "batch-summary", analysisPath],
    queryFn: () => video.getBatchSummary(analysisPath!),
    enabled: !!analysisPath && (resultsSubTab === "overview" || resultsSubTab === "strategy"),
  });

  const {
    data: selects,
    isLoading: selectsLoading,
  } = useQuery({
    queryKey: ["video", "selects", analysisPath],
    queryFn: () => video.getSelects(analysisPath!),
    enabled: !!analysisPath && resultsSubTab === "selects",
    select: (data) => mapApiSelects(data as unknown[]),
  });

  const {
    data: bins,
    isLoading: binsLoading,
  } = useQuery({
    queryKey: ["video", "bins", analysisPath],
    queryFn: () => video.getBins(analysisPath!),
    enabled: !!analysisPath && resultsSubTab === "bins",
    select: (data) => mapApiBins(data as unknown[]),
  });

  const {
    data: roughCut,
    isLoading: roughCutLoading,
  } = useQuery({
    queryKey: ["video", "rough-cut", analysisPath],
    queryFn: () => video.getRoughCut(analysisPath!),
    enabled: !!analysisPath && resultsSubTab === "rough-cut",
    select: (data) => mapApiRoughCut(data),
  });

  if (jobLoading) {
    return (
      <>
        <Header title="Job Details" description="Loading job data..." />
        <div className="flex items-center justify-center p-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  if (!job) {
    return (
      <>
        <Header title="Job Details" description="Job not found" />
        <div className="p-6">
          <p className="text-sm text-muted-foreground">
            Could not find job with ID: {jobId}
          </p>
        </div>
      </>
    );
  }

  const jobTypeLabel = job.type.replace(/_/g, " ");
  const createdDate = new Date(job.createdAt).toLocaleString();

  return (
    <>
      <Header
        title="Job Details"
        description={`${jobTypeLabel} — ${createdDate}`}
        actions={
          <Badge
            variant={
              isCompleted
                ? "default"
                : isFailed
                  ? "destructive"
                  : "secondary"
            }
          >
            {job.status}
          </Badge>
        }
      />
      <div className="p-6">
        {/* Running state — show progress */}
        {isRunning && (
          <div className="mx-auto max-w-xl">
            <ProgressTracker
              jobId={jobId}
              onComplete={handleJobComplete}
            />
          </div>
        )}

        {/* Failed state */}
        {isFailed && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">
              {isDrivePull ? "Download Failed" : "Analysis Failed"}
            </p>
            {job.error && (
              <p className="mt-1 text-xs text-destructive/80">{job.error}</p>
            )}
          </div>
        )}

        {/* Completed Drive Pull — show downloaded files */}
        {isCompleted && isDrivePull && (
          <div className="mx-auto max-w-2xl space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <HardDriveDownload className="size-5" />
                  Drive Download Complete
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="size-4" />
                  {downloadedFiles.length} video{downloadedFiles.length !== 1 ? "s" : ""} downloaded
                </div>

                {downloadedFiles.length > 0 && (
                  <ul className="max-h-[300px] space-y-1 overflow-y-auto">
                    {downloadedFiles.map((file, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <FileVideo className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm">{file.name}</span>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatFileSize(file.size)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {uploadId && (
                  <Button
                    className="w-full"
                    onClick={() =>
                      router.push(`/video?uploadId=${uploadId}`)
                    }
                  >
                    <Play className="size-4" />
                    Start Analysis on These Videos
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Completed Batch Analysis — show results */}
        {isCompleted && isBatchAnalysis && analysisPath && (
          <div className="space-y-6">
            <Tabs value={resultsSubTab} onValueChange={setResultsSubTab}>
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="strategy">Creative Strategy</TabsTrigger>
                <TabsTrigger value="selects">Selects</TabsTrigger>
                <TabsTrigger value="bins">Bins</TabsTrigger>
                <TabsTrigger value="rough-cut">Rough Cut</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4">
                {summaryLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading analysis overview...
                  </p>
                ) : batchSummary ? (
                  <VideoAnalysisOverview
                    videos={batchSummary.videoAnalyses}
                    stats={batchSummary.stats}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No analysis data available.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="strategy" className="mt-4">
                {summaryLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading creative strategy...
                  </p>
                ) : batchSummary?.creativeStrategy ? (
                  <CreativeStrategyView rows={batchSummary.creativeStrategy} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No creative strategy data available.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="selects" className="mt-4">
                {selectsLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading selects...
                  </p>
                ) : selects && selects.length > 0 ? (
                  <SelectsTable selects={selects} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No selects data available. Selects require frame extraction (FFmpeg) to identify video clips.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="bins" className="mt-4">
                {binsLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading bins...
                  </p>
                ) : bins && bins.length > 0 ? (
                  <BinsViewer bins={bins} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No bins data available. Bins require frame extraction (FFmpeg) to categorize clips.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="rough-cut" className="mt-4">
                {roughCutLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading rough cut...
                  </p>
                ) : roughCut && roughCut.length > 0 ? (
                  <RoughCutTimeline segments={roughCut} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No rough cut data available. Rough cuts require frame extraction (FFmpeg) to build timelines.
                  </p>
                )}
              </TabsContent>
            </Tabs>

            <SaveToLibrary jobId={analysisPath} />
            <ExportButtons analysisPath={analysisPath} />
          </div>
        )}
      </div>
    </>
  );
}
