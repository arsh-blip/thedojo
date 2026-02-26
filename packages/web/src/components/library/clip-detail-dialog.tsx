"use client";

import type { LibraryClip } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

interface ClipDetailDialogProps {
  clip: LibraryClip | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTimecodeMs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

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

export function ClipDetailDialog({
  clip,
  open,
  onOpenChange,
}: ClipDetailDialogProps) {
  if (!clip) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            {clip.sourceFileName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drive link */}
          {clip.driveWebViewLink && (
            <a
              href={clip.driveWebViewLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                View in Google Drive
              </Button>
            </a>
          )}

          {/* Timecodes and meta */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">In:</span>{" "}
              <span className="font-mono">
                {formatTimecodeMs(clip.timeRange.inSeconds)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Out:</span>{" "}
              <span className="font-mono">
                {formatTimecodeMs(clip.timeRange.outSeconds)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Duration:</span>{" "}
              <span className="font-mono">
                {formatDuration(clip.durationSeconds)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Scene Type:</span>{" "}
              <SceneTypeBadge type={clip.sceneType} />
            </div>
          </div>

          {/* Score */}
          <div className="text-sm">
            <span className="text-muted-foreground">Score:</span>{" "}
            <span className="font-semibold">{clip.score}</span>
            {clip.scoreRationale && (
              <p className="mt-1 text-muted-foreground">
                {clip.scoreRationale}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="text-sm">
            <p className="font-medium mb-1">Description</p>
            <p className="text-muted-foreground">{clip.description}</p>
          </div>

          {/* Transcript */}
          {clip.transcript && (
            <div className="text-sm">
              <p className="font-medium mb-1">Transcript</p>
              <div className="rounded-md border p-3 bg-muted/30 text-muted-foreground whitespace-pre-wrap">
                {clip.transcript}
              </div>
            </div>
          )}

          {/* On-screen text */}
          {clip.onScreenText.length > 0 && (
            <div className="text-sm">
              <p className="font-medium mb-1">On-Screen Text</p>
              <div className="flex flex-wrap gap-1">
                {clip.onScreenText.map((text, i) => (
                  <Badge key={i} variant="secondary">
                    {text}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Products */}
          {clip.products.length > 0 && (
            <div className="text-sm">
              <p className="font-medium mb-1">Products</p>
              <div className="flex flex-wrap gap-1">
                {clip.products.map((product, i) => (
                  <Badge key={i} variant="outline">
                    {product}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {clip.tags.length > 0 && (
            <div className="text-sm">
              <p className="font-medium mb-1">Tags</p>
              <div className="flex flex-wrap gap-1">
                {clip.tags.map((tag, i) => (
                  <Badge key={i} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* People */}
          {clip.people && (
            <div className="text-sm">
              <p className="font-medium mb-1">People</p>
              <p className="text-muted-foreground">{clip.people}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
