"use client";

import { useState } from "react";
import { Loader2, Play, ChevronDown, FileText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { video, library } from "@/lib/api-client";
import { toast } from "sonner";

interface BatchLauncherProps {
  uploadId: string | null;
  onBatchStarted: (jobId: string) => void;
  brandName: string;
  onBrandNameChange: (name: string) => void;
  brandContext: string;
  onBrandContextChange: (context: string) => void;
  selectedBrandSlug: string | null;
  onBrandSlugChange: (slug: string | null) => void;
}

export function BatchLauncher({
  uploadId,
  onBatchStarted,
  brandName,
  onBrandNameChange,
  brandContext,
  onBrandContextChange,
  selectedBrandSlug,
  onBrandSlugChange,
}: BatchLauncherProps) {
  const [starting, setStarting] = useState(false);
  const [showMessagingDoc, setShowMessagingDoc] = useState(false);

  const { data: brands } = useQuery({
    queryKey: ["library", "brands"],
    queryFn: () => library.listBrands(),
  });

  const selectedBrand = brands?.find((b) => b.slug === selectedBrandSlug);

  const { data: messagingDoc } = useQuery({
    queryKey: ["library", "messaging-doc", selectedBrandSlug],
    queryFn: () => library.getMessagingDocContent(selectedBrandSlug!),
    enabled: !!selectedBrandSlug && !!selectedBrand?.messagingDocId,
  });

  const handleBrandSelect = (value: string) => {
    if (value === "__custom__") {
      onBrandSlugChange(null);
      onBrandNameChange("");
    } else {
      onBrandSlugChange(value);
      const brand = brands?.find((b) => b.slug === value);
      if (brand) {
        onBrandNameChange(brand.name);
      }
    }
  };

  const handleStart = async () => {
    if (!uploadId) return;
    setStarting(true);
    try {
      const result = await video.startBatch(
        uploadId,
        brandContext.trim() || undefined,
        selectedBrandSlug || undefined,
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

  const hasMessagingDoc = !!selectedBrandSlug && !!selectedBrand?.messagingDocId;

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
        <Label htmlFor="brand-select">Brand (optional)</Label>
        <div className="relative">
          <select
            id="brand-select"
            value={selectedBrandSlug ?? "__custom__"}
            onChange={(e) => handleBrandSelect(e.target.value)}
            disabled={!uploadId || starting}
            className="flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="__custom__">Custom (new brand)</option>
            {brands?.map((brand) => (
              <option key={brand.slug} value={brand.slug}>
                {brand.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
        <p className="text-xs text-muted-foreground">
          Select an existing brand or create a new one.
        </p>
      </div>

      {!selectedBrandSlug && (
        <div className="space-y-2">
          <Label htmlFor="brand-name">Brand Name</Label>
          <Input
            id="brand-name"
            value={brandName}
            onChange={(e) => onBrandNameChange(e.target.value)}
            placeholder="e.g. Glossier, Summer Fridays..."
            disabled={!uploadId || starting}
          />
          <p className="text-xs text-muted-foreground">
            Used to organize results in the Clip Library.
          </p>
        </div>
      )}

      {hasMessagingDoc && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              <FileText className="h-3 w-3" />
              Auto-loaded from {messagingDoc?.fileName ?? selectedBrand?.messagingDocName ?? "messaging doc"}
            </span>
            <button
              type="button"
              onClick={() => setShowMessagingDoc(!showMessagingDoc)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              {showMessagingDoc ? "Hide" : "Show"} messaging doc
            </button>
          </div>
          {showMessagingDoc && messagingDoc?.content && (
            <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
              {messagingDoc.content}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="brand-context">
          {hasMessagingDoc
            ? "Additional Context (optional)"
            : "Brand Context (optional)"}
        </Label>
        <Textarea
          id="brand-context"
          value={brandContext}
          onChange={(e) => onBrandContextChange(e.target.value)}
          placeholder={
            hasMessagingDoc
              ? "Add any extra context beyond the messaging doc..."
              : "Describe the brand, product, or campaign context to help guide the analysis..."
          }
          rows={4}
          disabled={!uploadId || starting}
        />
        <p className="text-xs text-muted-foreground">
          {hasMessagingDoc
            ? "The messaging doc is already loaded. Add any additional context here."
            : "Providing brand context helps the AI understand the purpose of the footage and produce more relevant results."}
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
