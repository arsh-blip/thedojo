"use client";

import { useState } from "react";
import { Library, Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { library } from "@/lib/api-client";
import { toast } from "sonner";

const CREATE_NEW_VALUE = "__create_new__";

interface SaveToLibraryProps {
  jobId: string;
  defaultBrandName?: string;
  brandContext?: string;
}

export function SaveToLibrary({
  jobId,
  defaultBrandName,
  brandContext,
}: SaveToLibraryProps) {
  const [open, setOpen] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [newBrandName, setNewBrandName] = useState(defaultBrandName ?? "");
  const queryClient = useQueryClient();

  const { data: brands, isLoading: brandsLoading } = useQuery({
    queryKey: ["library", "brands"],
    queryFn: () => library.listBrands(),
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      let slug: string;

      if (selectedBrand === CREATE_NEW_VALUE) {
        const trimmed = newBrandName.trim();
        if (!trimmed) throw new Error("Brand name is required");
        const brand = await library.createBrand(trimmed);
        slug = brand.slug;
      } else {
        slug = selectedBrand;
      }

      return library.saveAnalysis(
        slug,
        jobId,
        brandContext?.trim() || undefined
      );
    },
    onSuccess: () => {
      const brandName =
        selectedBrand === CREATE_NEW_VALUE
          ? newBrandName.trim()
          : brands?.find((b) => b.slug === selectedBrand)?.name ?? selectedBrand;

      queryClient.invalidateQueries({ queryKey: ["library", "brands"] });
      toast.success(`Saved to ${brandName} library`);
      setOpen(false);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to save to library"
      );
    },
  });

  const isCreatingNew = selectedBrand === CREATE_NEW_VALUE;
  const canSave =
    selectedBrand &&
    (!isCreatingNew || newBrandName.trim().length > 0) &&
    !saveMutation.isPending;

  // Pre-select "Create New Brand" and fill name when dialog opens with a defaultBrandName
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setSelectedBrand("");
      setNewBrandName(defaultBrandName ?? "");
      if (defaultBrandName?.trim()) {
        setSelectedBrand(CREATE_NEW_VALUE);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <Library className="mr-2 h-4 w-4" />
          Save to Clip Library
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save to Clip Library</DialogTitle>
          <DialogDescription>
            Choose a brand to save this analysis under, or create a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Brand</Label>
            {brandsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading brands...
              </div>
            ) : (
              <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a brand..." />
                </SelectTrigger>
                <SelectContent>
                  {brands?.map((brand) => (
                    <SelectItem key={brand.slug} value={brand.slug}>
                      {brand.name} ({brand.analysisCount} analyses)
                    </SelectItem>
                  ))}
                  <SelectItem value={CREATE_NEW_VALUE}>
                    + Create New Brand
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {isCreatingNew && (
            <div className="space-y-2">
              <Label htmlFor="new-brand-name">New Brand Name</Label>
              <Input
                id="new-brand-name"
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
                placeholder="Enter brand name..."
                autoFocus
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!canSave}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
