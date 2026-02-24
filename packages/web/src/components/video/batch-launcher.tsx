"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { video } from "@/lib/api-client";
import { toast } from "sonner";

interface BatchLauncherProps {
  uploadId: string | null;
  onBatchStarted: (jobId: string) => void;
}

export function BatchLauncher({ uploadId, onBatchStarted }: BatchLauncherProps) {
  const [brandContext, setBrandContext] = useState("");
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    if (!uploadId) return;
    setStarting(true);
    try {
      const result = await video.startBatch(
        uploadId,
        brandContext.trim() || undefined
      );
      toast.success("Analysis batch started");
      onBatchStarted(result.jobId);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start analysis"
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="upload-id">Upload ID</Label>
        <Input
          id="upload-id"
          value={uploadId ?? ""}
          readOnly
          placeholder="Upload videos first to get an upload ID"
          className="bg-muted/50 font-mono text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="brand-context">Brand Context (optional)</Label>
        <Textarea
          id="brand-context"
          value={brandContext}
          onChange={(e) => setBrandContext(e.target.value)}
          placeholder="Describe the brand, product, or campaign context to help guide the analysis..."
          rows={4}
          disabled={!uploadId || starting}
        />
        <p className="text-xs text-muted-foreground">
          Providing brand context helps the AI understand the purpose of the
          footage and produce more relevant results.
        </p>
      </div>

      <Button
        onClick={handleStart}
        disabled={!uploadId || starting}
        className="w-full"
        size="lg"
      >
        {starting ? (
          <>
            <Loader2 className="animate-spin" />
            Starting Analysis...
          </>
        ) : (
          <>
            <Play />
            Start Analysis
          </>
        )}
      </Button>
    </div>
  );
}
