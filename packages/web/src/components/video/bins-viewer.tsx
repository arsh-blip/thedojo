"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderOpen } from "lucide-react";

export interface BinClip {
  file: string;
  start: number;
  end: number;
  duration: number;
  description: string;
}

export interface Bin {
  sceneType: string;
  clips: BinClip[];
  totalDuration: number;
}

/** Map API response shape to the component's expected shape */
export function mapApiBins(raw: unknown[]): Bin[] {
  return (raw || []).map((b: any) => {
    const clips: BinClip[] = (b.selects || b.clips || []).map((s: any) => ({
      file: s.file ?? s.sourceFileName ?? "",
      start: s.start ?? s.timeRange?.inSeconds ?? 0,
      end: s.end ?? s.timeRange?.outSeconds ?? 0,
      duration: s.duration ?? s.durationSeconds ?? 0,
      description: s.description ?? "",
    }));
    return {
      sceneType: b.sceneType ?? b.name ?? "",
      clips,
      totalDuration: b.totalDuration ?? clips.reduce((sum: number, c: BinClip) => sum + c.duration, 0),
    };
  });
}

interface BinsViewerProps {
  bins: Bin[];
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export function BinsViewer({ bins }: BinsViewerProps) {
  if (bins.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
        <p className="text-sm">No bins available.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {bins.map((bin) => (
        <Card key={bin.sceneType}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderOpen className="size-4 text-muted-foreground" />
                {bin.sceneType}
              </CardTitle>
              <Badge variant="outline">{bin.clips.length} clips</Badge>
            </div>
            <CardDescription>
              Total: {formatDuration(bin.totalDuration)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {bin.clips.map((clip, i) => (
                <li
                  key={`${clip.file}-${clip.start}-${i}`}
                  className="rounded-md border px-3 py-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate text-xs font-mono">
                      {clip.file}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {clip.duration.toFixed(1)}s
                    </span>
                  </div>
                  {clip.description && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {clip.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
