"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { library } from "@/lib/api-client";
import type { LibraryClip } from "@/lib/api-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, ExternalLink } from "lucide-react";
import { ClipDetailDialog } from "./clip-detail-dialog";
import { DriveDocPicker } from "./drive-doc-picker";

interface ClipBrowserProps {
  brandSlug: string;
}

const SCENE_TYPES = [
  "hook",
  "body",
  "cta",
  "b-roll",
  "transition",
  "testimonial",
  "product_shot",
] as const;

const sceneTypeColorMap: Record<string, string> = {
  hook: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  body: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  cta: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  "b-roll":
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  transition:
    "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  testimonial:
    "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  product_shot:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

function SceneTypeBadge({ type }: { type: string }) {
  const color = sceneTypeColorMap[type] ?? "";
  return (
    <Badge variant="outline" className={color}>
      {type}
    </Badge>
  );
}

function getCaptionStatus(onScreenText: string[]): { label: string; className: string } {
  if (!onScreenText || onScreenText.length === 0) {
    return { label: "No Captions", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" };
  }
  if (onScreenText.length <= 2) {
    return { label: "Some Captions", className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" };
  }
  return { label: "Captions", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" };
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function ClipBrowser({ brandSlug }: ClipBrowserProps) {
  const queryClient = useQueryClient();
  const [sceneTypeFilter, setSceneTypeFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [minScore, setMinScore] = useState<number>(0);
  const [searchText, setSearchText] = useState("");
  const [analysisFilter, setAnalysisFilter] = useState<string>("all");
  const [captionFilter, setCaptionFilter] = useState<string>("all");
  const [selectedClip, setSelectedClip] = useState<LibraryClip | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: brand } = useQuery({
    queryKey: ["library", "brands", brandSlug],
    queryFn: () => library.getBrand(brandSlug),
  });

  // Build query params
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (sceneTypeFilter !== "all") p.sceneType = sceneTypeFilter;
    if (productFilter !== "all") p.product = productFilter;
    if (minScore > 0) p.minScore = String(minScore);
    if (searchText.trim()) p.search = searchText.trim();
    if (analysisFilter !== "all") p.analysisId = analysisFilter;
    return Object.keys(p).length > 0 ? p : undefined;
  }, [sceneTypeFilter, productFilter, minScore, searchText, analysisFilter]);

  const {
    data: clips,
    isLoading: clipsLoading,
  } = useQuery({
    queryKey: ["library", "clips", brandSlug, params],
    queryFn: () => library.searchClips(brandSlug, params),
  });

  const { data: analyses } = useQuery({
    queryKey: ["library", "analyses", brandSlug],
    queryFn: () => library.listAnalyses(brandSlug),
  });

  // Derive unique product names from all loaded clips
  const productNames = useMemo(() => {
    if (!clips) return [];
    return [...new Set(clips.flatMap((c) => c.products).filter(Boolean))].sort();
  }, [clips]);

  // Client-side caption status filter
  const filteredClips = useMemo(() => {
    if (!clips || captionFilter === "all") return clips;
    return clips.filter((c) => {
      const status = getCaptionStatus(c.onScreenText);
      if (captionFilter === "captions") return status.label === "Captions";
      if (captionFilter === "some") return status.label === "Some Captions";
      if (captionFilter === "none") return status.label === "No Captions";
      return true;
    });
  }, [clips, captionFilter]);

  function handleRowClick(clip: LibraryClip) {
    setSelectedClip(clip);
    setDetailOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Brand info section */}
      {brand && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 mb-4">
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium">{brand.name}</p>
            <DriveDocPicker
              selectedFileId={brand?.messagingDocId}
              selectedFileName={brand?.messagingDocName}
              onSelect={async (id, name) => {
                await library.updateBrand(brandSlug, { messagingDocId: id, messagingDocName: name });
                queryClient.invalidateQueries({ queryKey: ["library", "brands"] });
              }}
              onClear={async () => {
                await library.updateBrand(brandSlug, { messagingDocId: null, messagingDocName: null });
                queryClient.invalidateQueries({ queryKey: ["library", "brands"] });
              }}
            />
          </div>
        </div>
      )}

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label>Scene Type</Label>
          <Select value={sceneTypeFilter} onValueChange={setSceneTypeFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {SCENE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Caption Status</Label>
          <Select value={captionFilter} onValueChange={setCaptionFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="captions">Captions</SelectItem>
              <SelectItem value="some">Some Captions</SelectItem>
              <SelectItem value="none">No Captions</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {productNames.length > 0 && (
          <div className="space-y-1.5">
            <Label>Product</Label>
            <Select value={productFilter} onValueChange={setProductFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All products" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All products</SelectItem>
                {productNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="lib-min-score">Min Score</Label>
          <Input
            id="lib-min-score"
            type="number"
            min={0}
            max={100}
            step={1}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-[100px]"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="lib-search">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="lib-search"
              placeholder="Search clips..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-[200px] pl-8"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Analysis</Label>
          <Select value={analysisFilter} onValueChange={setAnalysisFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="All Analyses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Analyses</SelectItem>
              {analyses?.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {new Date(a.savedAt).toLocaleDateString()} ({a.clipCount}{" "}
                  clips)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="text-sm text-muted-foreground">
          {filteredClips ? `${filteredClips.length} clips` : ""}
        </div>
      </div>

      {/* Results table */}
      {clipsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source File</TableHead>
              <TableHead>Scene Type</TableHead>
              <TableHead>Caption Status</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[40px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!filteredClips || filteredClips.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground"
                >
                  No clips match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              filteredClips.map((clip) => (
                <TableRow
                  key={clip.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleRowClick(clip)}
                >
                  <TableCell className="max-w-[200px] truncate font-mono text-xs">
                    {clip.sourceFileName}
                  </TableCell>
                  <TableCell>
                    <SceneTypeBadge type={clip.sceneType} />
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const status = getCaptionStatus(clip.onScreenText);
                      return (
                        <Badge variant="outline" className={status.className}>
                          {status.label}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="font-medium">{clip.score}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatDuration(clip.durationSeconds)}
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">
                    {clip.description}
                  </TableCell>
                  <TableCell>
                    {clip.driveWebViewLink && (
                      <a
                        href={clip.driveWebViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center text-muted-foreground hover:text-foreground"
                        title="View in Google Drive"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      <ClipDetailDialog
        clip={selectedClip}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
