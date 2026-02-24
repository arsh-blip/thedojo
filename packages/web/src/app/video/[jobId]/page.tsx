"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/layout/header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProgressTracker } from "@/components/video/progress-tracker";
import { SelectsTable, type VideoSelect } from "@/components/video/selects-table";
import { BinsViewer, type Bin } from "@/components/video/bins-viewer";
import { RoughCutTimeline, type TimelineSegment } from "@/components/video/rough-cut-timeline";
import { ExportButtons } from "@/components/video/export-buttons";
import { jobs, video } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

export default function JobResultsPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;

  const [resultsSubTab, setResultsSubTab] = useState("selects");
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
  const analysisPath = isCompleted ? jobId : null;

  const handleJobComplete = () => {
    setCompletedFromSSE(true);
    refetchJob();
  };

  const {
    data: selects,
    isLoading: selectsLoading,
  } = useQuery({
    queryKey: ["video", "selects", analysisPath],
    queryFn: () => video.getSelects(analysisPath!),
    enabled: !!analysisPath && resultsSubTab === "selects",
    select: (data) => data as unknown as VideoSelect[],
  });

  const {
    data: bins,
    isLoading: binsLoading,
  } = useQuery({
    queryKey: ["video", "bins", analysisPath],
    queryFn: () => video.getBins(analysisPath!),
    enabled: !!analysisPath && resultsSubTab === "bins",
    select: (data) => data as unknown as Bin[],
  });

  const {
    data: roughCut,
    isLoading: roughCutLoading,
  } = useQuery({
    queryKey: ["video", "rough-cut", analysisPath],
    queryFn: () => video.getRoughCut(analysisPath!),
    enabled: !!analysisPath && resultsSubTab === "rough-cut",
    select: (data) => data as unknown as TimelineSegment[],
  });

  if (jobLoading) {
    return (
      <>
        <Header title="Job Results" description="Loading job data..." />
        <div className="flex items-center justify-center p-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  if (!job) {
    return (
      <>
        <Header title="Job Results" description="Job not found" />
        <div className="p-6">
          <p className="text-sm text-muted-foreground">
            Could not find job with ID: {jobId}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Job Results"
        description={`Job ${jobId}`}
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
        {isRunning && (
          <div className="mx-auto max-w-xl">
            <ProgressTracker
              jobId={jobId}
              onComplete={handleJobComplete}
            />
          </div>
        )}

        {isFailed && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">
              Analysis Failed
            </p>
            {job.error && (
              <p className="mt-1 text-xs text-destructive/80">{job.error}</p>
            )}
          </div>
        )}

        {isCompleted && analysisPath && (
          <div className="space-y-6">
            <Tabs value={resultsSubTab} onValueChange={setResultsSubTab}>
              <TabsList>
                <TabsTrigger value="selects">Selects</TabsTrigger>
                <TabsTrigger value="bins">Bins</TabsTrigger>
                <TabsTrigger value="rough-cut">Rough Cut</TabsTrigger>
              </TabsList>

              <TabsContent value="selects" className="mt-4">
                {selectsLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading selects...
                  </p>
                ) : selects ? (
                  <SelectsTable selects={selects} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No selects data available.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="bins" className="mt-4">
                {binsLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading bins...
                  </p>
                ) : bins ? (
                  <BinsViewer bins={bins} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No bins data available.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="rough-cut" className="mt-4">
                {roughCutLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading rough cut...
                  </p>
                ) : roughCut ? (
                  <RoughCutTimeline segments={roughCut} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No rough cut data available.
                  </p>
                )}
              </TabsContent>
            </Tabs>

            <ExportButtons analysisPath={analysisPath} />
          </div>
        )}
      </div>
    </>
  );
}
