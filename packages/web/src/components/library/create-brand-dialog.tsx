"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { library } from "@/lib/api-client";
import type { BrandMeta } from "@/lib/api-client";
import { toast } from "sonner";
import { DriveDocPicker } from "./drive-doc-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CreateBrandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (brand: BrandMeta) => void;
}

export function CreateBrandDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateBrandDialogProps) {
  const [name, setName] = useState("");
  const [messagingDocId, setMessagingDocId] = useState<string | undefined>();
  const [messagingDocName, setMessagingDocName] = useState<string | undefined>();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (brandName: string) => library.createBrand(brandName),
    onSuccess: async (data) => {
      if (messagingDocId) {
        await library.updateBrand(data.slug, { messagingDocId, messagingDocName });
      }
      toast.success(`Brand "${data.name}" created successfully.`);
      queryClient.invalidateQueries({ queryKey: ["library", "brands"] });
      onCreated?.(data);
      resetAndClose();
    },
    onError: (error: Error) => {
      toast.error(`Failed to create brand: ${error.message}`);
    },
  });

  function resetAndClose() {
    setName("");
    setMessagingDocId(undefined);
    setMessagingDocName(undefined);
    onOpenChange(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Please enter a brand name.");
      return;
    }
    mutation.mutate(trimmedName);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Brand</DialogTitle>
            <DialogDescription>
              Add a new brand to organize your analyzed clips.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="brand-name">Brand Name</Label>
              <Input
                id="brand-name"
                placeholder="Enter brand name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Messaging Document (optional)</label>
              <DriveDocPicker
                selectedFileId={messagingDocId}
                selectedFileName={messagingDocName}
                onSelect={(id, name) => { setMessagingDocId(id); setMessagingDocName(name); }}
                onClear={() => { setMessagingDocId(undefined); setMessagingDocName(undefined); }}
              />
              <p className="text-xs text-muted-foreground">
                Link a Google Drive spreadsheet or doc with the brand's messaging angles.
              </p>
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={resetAndClose}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !name.trim()}
            >
              {mutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
