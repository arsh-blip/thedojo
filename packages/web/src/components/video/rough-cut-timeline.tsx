"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

export interface TimelineSegment {
  narrativeType: string;
  start: number;
  end: number;
  duration: number;
}

interface RoughCutTimelineProps {
  segments: TimelineSegment[];
}

const NARRATIVE_COLORS: Record<string, string> = {
  hook: "bg-rose-500",
  intro: "bg-sky-500",
  problem: "bg-amber-500",
  solution: "bg-emerald-500",
  benefit: "bg-violet-500",
  social_proof: "bg-pink-500",
  testimonial: "bg-pink-500",
  demo: "bg-teal-500",
  feature: "bg-cyan-500",
  cta: "bg-orange-500",
  outro: "bg-slate-500",
  transition: "bg-gray-400",
};

function getSegmentColor(narrativeType: string): string {
  const key = narrativeType.toLowerCase().replace(/[\s-]/g, "_");
  return NARRATIVE_COLORS[key] ?? "bg-primary";
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export function RoughCutTimeline({ segments }: RoughCutTimelineProps) {
  const totalDuration = useMemo(
    () => segments.reduce((sum, s) => sum + s.duration, 0),
    [segments]
  );

  if (segments.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
        <p className="text-sm">No rough cut data available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Rough Cut Timeline</span>
        <span className="text-muted-foreground">
          Total: {formatDuration(totalDuration)}
        </span>
      </div>

      <ScrollArea className="w-full">
        <div className="flex h-16 min-w-[600px] gap-0.5 rounded-lg border bg-muted/30 p-1">
          {segments.map((segment, i) => {
            const widthPercent = (segment.duration / totalDuration) * 100;
            return (
              <div
                key={`${segment.narrativeType}-${segment.start}-${i}`}
                className={cn(
                  "relative flex items-center justify-center overflow-hidden rounded-md text-white transition-opacity hover:opacity-90",
                  getSegmentColor(segment.narrativeType)
                )}
                style={{ width: `${Math.max(widthPercent, 2)}%` }}
                title={`${segment.narrativeType} (${segment.duration.toFixed(1)}s)`}
              >
                {widthPercent > 6 && (
                  <span className="truncate px-1 text-[10px] font-medium leading-tight">
                    {segment.narrativeType}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <div className="flex flex-wrap gap-3">
        {segments.map((segment, i) => (
          <div
            key={`legend-${segment.narrativeType}-${segment.start}-${i}`}
            className="flex items-center gap-1.5 text-xs"
          >
            <div
              className={cn(
                "size-2.5 rounded-sm",
                getSegmentColor(segment.narrativeType)
              )}
            />
            <span className="text-muted-foreground">
              {segment.narrativeType}
            </span>
            <span className="font-mono">{segment.duration.toFixed(1)}s</span>
          </div>
        ))}
      </div>
    </div>
  );
}
