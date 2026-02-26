"use client";

import { Suspense, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadZone } from "@/components/video/upload-zone";
import { BatchLauncher } from "@/components/video/batch-launcher";
import { ProgressTracker } from "@/components/video/progress-tracker";
import { SelectsTable, mapApiSelects } from "@/components/video/selects-table";
import { BinsViewer, mapApiBins } from "@/components/video/bins-viewer";
import { RoughCutTimeline, mapApiRoughCut } from "@/components/video/rough-cut-timeline";
import { ExportButtons } from "@/components/video/export-buttons";
import { SaveToLibrary } from "@/components/video/save-to-library";
import { DriveVideoProgress } from "@/components/video/drive-video-progress";
import { CreativeStrategyView } from "@/components/video/creative-strategy-view";
import { VideoAnalysisOverview } from "@/components/video/video-analysis-summary";
import { video, type UploadResult } from "@/lib/api-client";

export default function VideoPage() {
  return (
    <Suspense>
      <VideoPageContent />
    </Suspense>
  );
}

function VideoPageContent() {
  const searchParams = useSearchParams();
  const pullJobId = searchParams.get("pullJobId");
  const pullUploadId = searchParams.get("uploadId");

  const initialTab = pullJobId ? "drive-pull" : pullUploadId ? "analyze" : "upload";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [uploadId, setUploadId] = useState<string | null>(pullUploadId);
  const [jobId, setJobId] = useState<string | null>(null);
  const [analysisPath, setAnalysisPath] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("");
  const [brandContext, setBrandContext] = useState("");
  const [selectedBrandSlug, setSelectedBrandSlug] = useState<string | null>(null);
  const [resultsSubTab, setResultsSubTab] = useState("overview");

  // If we arrived from Drive with a pull job, start on the drive-pull tab
  useEffect(() => {
    if (pullJobId && pullUploadId) {
      setActiveTab("drive-pull");
      setUploadId(pullUploadId);
    }
  }, [pullJobId, pullUploadId]);

  const handleUploadComplete = (result: UploadResult) => {
    setUploadId(result.uploadId);
    setActiveTab("analyze");
  };

  const handleDrivePullComplete = () => {
    // Upload ID was already set from URL params — go to analyze
    setActiveTab("analyze");
  };

  const handleBatchStarted = (newJobId: string) => {
    setJobId(newJobId);
    setActiveTab("progress");
  };

  const handleJobComplete = (completedJobId: string) => {
    setAnalysisPath(completedJobId);
    setActiveTab("results");
  };

  // Batch summary (creative strategy + video analysis data)
  const {
    data: batchSummary,
    isLoading: summaryLoading,
  } = useQuery({
    queryKey: ["video", "batch-summary", analysisPath],
    queryFn: () => video.getBatchSummary(analysisPath!),
    enabled: !!analysisPath && activeTab === "results" && (resultsSubTab === "overview" || resultsSubTab === "strategy"),
  });

  const {
    data: selects,
    isLoading: selectsLoading,
  } = useQuery({
    queryKey: ["video", "selects", analysisPath],
    queryFn: () => video.getSelects(analysisPath!),
    enabled: !!analysisPath && activeTab === "results" && resultsSubTab === "selects",
    select: (data) => mapApiSelects(data as unknown[]),
  });

  const {
    data: bins,
    isLoading: binsLoading,
  } = useQuery({
    queryKey: ["video", "bins", analysisPath],
    queryFn: () => video.getBins(analysisPath!),
    enabled: !!analysisPath && activeTab === "results" && resultsSubTab === "bins",
    select: (data) => mapApiBins(data as unknown[]),
  });

  const {
    data: roughCut,
    isLoading: roughCutLoading,
  } = useQuery({
    queryKey: ["video", "rough-cut", analysisPath],
    queryFn: () => video.getRoughCut(analysisPath!),
    enabled: !!analysisPath && activeTab === "results" && resultsSubTab === "rough-cut",
    select: (data) => mapApiRoughCut(data),
  });

  return (
    <>
      <Header
        title="Video Analysis"
        description="Upload videos, analyze footage, and export Premiere Pro projects"
      />
      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {pullJobId && (
              <TabsTrigger value="drive-pull">Drive Download</TabsTrigger>
            )}
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="analyze" disabled={!uploadId}>
              Analyze
            </TabsTrigger>
            <TabsTrigger value="progress" disabled={!jobId}>
              Progress
            </TabsTrigger>
            <TabsTrigger value="results" disabled={!analysisPath}>
              Results
            </TabsTrigger>
            <TabsTrigger value="export" disabled={!analysisPath}>
              Export
            </TabsTrigger>
          </TabsList>

          {pullJobId && (
            <TabsContent value="drive-pull" className="mt-6">
              <div className="mx-auto max-w-xl">
                <DriveVideoProgress
                  jobId={pullJobId}
                  onComplete={handleDrivePullComplete}
                />
              </div>
            </TabsContent>
          )}

          <TabsContent value="upload" className="mt-6">
            <div className="mx-auto max-w-xl">
              <UploadZone onUploadComplete={handleUploadComplete} />
            </div>
          </TabsContent>

          <TabsContent value="analyze" className="mt-6">
            <div className="mx-auto max-w-xl">
              <BatchLauncher
                uploadId={uploadId}
                onBatchStarted={handleBatchStarted}
                brandName={brandName}
                onBrandNameChange={setBrandName}
                brandContext={brandContext}
                onBrandContextChange={setBrandContext}
                selectedBrandSlug={selectedBrandSlug}
                onBrandSlugChange={setSelectedBrandSlug}
              />
            </div>
          </TabsContent>

          <TabsContent value="progress" className="mt-6">
            <div className="mx-auto max-w-xl">
              <ProgressTracker
                jobId={jobId}
                onComplete={handleJobComplete}
              />
            </div>
          </TabsContent>

          <TabsContent value="results" className="mt-6">
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
          </TabsContent>

          <TabsContent value="export" className="mt-6">
            {analysisPath ? (
              <div className="mx-auto max-w-xl space-y-4">
                <SaveToLibrary
                  jobId={analysisPath}
                  defaultBrandName={brandName}
                  brandContext={brandContext}
                />
                <ExportButtons analysisPath={analysisPath} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Complete an analysis first to export results.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
