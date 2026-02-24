"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { drive } from "@/lib/api-client";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentFolderId: string;
}

type ItemType = "folder" | "presentation";

export function CreateDialog({
  open,
  onOpenChange,
  currentFolderId,
}: CreateDialogProps) {
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<ItemType>("folder");
  const queryClient = useQueryClient();

  const createFolderMutation = useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId: string }) =>
      drive.createFolder(name, parentId),
    onSuccess: (data) => {
      toast.success(`Folder "${data.name}" created successfully.`);
      queryClient.invalidateQueries({ queryKey: ["drive", "folder"] });
      resetAndClose();
    },
    onError: (error: Error) => {
      toast.error(`Failed to create folder: ${error.message}`);
    },
  });

  const createPresentationMutation = useMutation({
    mutationFn: ({
      name,
      folderId,
    }: {
      name: string;
      folderId: string;
    }) => drive.createPresentation(name, folderId),
    onSuccess: (data) => {
      toast.success(`Presentation "${data.name}" created successfully.`);
      queryClient.invalidateQueries({ queryKey: ["drive", "folder"] });
      resetAndClose();
    },
    onError: (error: Error) => {
      toast.error(`Failed to create presentation: ${error.message}`);
    },
  });

  const isPending =
    createFolderMutation.isPending || createPresentationMutation.isPending;

  function resetAndClose() {
    setName("");
    setItemType("folder");
    onOpenChange(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Please enter a name.");
      return;
    }

    if (itemType === "folder") {
      createFolderMutation.mutate({
        name: trimmedName,
        parentId: currentFolderId,
      });
    } else {
      createPresentationMutation.mutate({
        name: trimmedName,
        folderId: currentFolderId,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Item</DialogTitle>
            <DialogDescription>
              Create a new folder or presentation in the current directory.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="item-type">Type</Label>
              <Select
                value={itemType}
                onValueChange={(value: string) =>
                  setItemType(value as ItemType)
                }
              >
                <SelectTrigger className="w-full" id="item-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="folder">Folder</SelectItem>
                  <SelectItem value="presentation">Presentation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-name">Name</Label>
              <Input
                id="item-name"
                placeholder={
                  itemType === "folder"
                    ? "Enter folder name"
                    : "Enter presentation name"
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={resetAndClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
