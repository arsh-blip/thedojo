"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/layout/header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadZone } from "@/components/video/upload-zone";
import { BatchLauncher } from "@/components/video/batch-launcher";
import { ProgressTracker } from "@/components/video/progress-tracker";
import { SelectsTable, type VideoSelect } from "@/components/video/selects-table";
import { BinsViewer, type Bin } from "@/components/video/bins-viewer";
import { RoughCutTimeline, type TimelineSegment } from "@/components/video/rough-cut-timeline";
import { ExportButtons } from "@/components/video/export-buttons";
import { video, type UploadResult } from "@/lib/api-client";

export default function VideoPage() {
  const [activeTab, setActiveTab] = useState("upload");
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [analysisPath, setAnalysisPath] = useState<string | null>(null);
  const [resultsSubTab, setResultsSubTab] = useState("selects");

  const handleUploadComplete = (result: UploadResult) => {
    setUploadId(result.uploadId);
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

  const {
    data: selects,
    isLoading: selectsLoading,
  } = useQuery({
    queryKey: ["video", "selects", analysisPath],
    queryFn: () => video.getSelects(analysisPath!),
    enabled: !!analysisPath && activeTab === "results" && resultsSubTab === "selects",
    select: (data) => data as unknown as VideoSelect[],
  });

  const {
    data: bins,
    isLoading: binsLoading,
  } = useQuery({
    queryKey: ["video", "bins", analysisPath],
    queryFn: () => video.getBins(analysisPath!),
    enabled: !!analysisPath && activeTab === "results" && resultsSubTab === "bins",
    select: (data) => data as unknown as Bin[],
  });

  const {
    data: roughCut,
    isLoading: roughCutLoading,
  } = useQuery({
    queryKey: ["video", "rough-cut", analysisPath],
    queryFn: () => video.getRoughCut(analysisPath!),
    enabled: !!analysisPath && activeTab === "results" && resultsSubTab === "rough-cut",
    select: (data) => data as unknown as TimelineSegment[],
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
          </TabsContent>

          <TabsContent value="export" className="mt-6">
            {analysisPath ? (
              <div className="mx-auto max-w-xl">
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
