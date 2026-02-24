"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { drive, type DriveItem } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Search,
  Plus,
  Presentation,
  CheckCircle2,
  Loader2,
} from "lucide-react";

interface PresentationPickerProps {
  value: DriveItem | null;
  onChange: (item: DriveItem) => void;
}

export function PresentationPicker({
  value,
  onChange,
}: PresentationPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFolderId, setNewFolderId] = useState("");

  // Debounced search
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(
    null
  );

  function handleSearchChange(q: string) {
    setSearchQuery(q);
    if (searchTimeout) clearTimeout(searchTimeout);
    const timeout = setTimeout(() => {
      setDebouncedQuery(q);
    }, 400);
    setSearchTimeout(timeout);
  }

  const searchResults = useQuery({
    queryKey: ["drive-search-presentations", debouncedQuery],
    queryFn: () =>
      drive.search(
        `${debouncedQuery} mimeType='application/vnd.google-apps.presentation'`
      ),
    enabled: debouncedQuery.length >= 2,
  });

  const createMutation = useMutation({
    mutationFn: ({
      name,
      folderId,
    }: {
      name: string;
      folderId: string;
    }) => drive.createPresentation(name, folderId),
    onSuccess: (item) => {
      toast.success(`Created presentation "${item.name}"`);
      onChange(item);
      setDialogOpen(false);
      setNewName("");
      setNewFolderId("");
    },
    onError: (err: Error) => {
      toast.error(`Failed to create presentation: ${err.message}`);
    },
  });

  function handleCreate() {
    if (!newName.trim()) {
      toast.error("Please enter a presentation name");
      return;
    }
    if (!newFolderId.trim()) {
      toast.error("Please enter a folder ID");
      return;
    }
    createMutation.mutate({ name: newName.trim(), folderId: newFolderId.trim() });
  }

  return (
    <div className="space-y-4">
      {/* Selected presentation info */}
      {value && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">Selected Presentation</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Presentation className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{value.name}</p>
                <p className="text-xs text-muted-foreground">ID: {value.id}</p>
                {value.modifiedTime && (
                  <p className="text-xs text-muted-foreground">
                    Modified:{" "}
                    {new Date(value.modifiedTime).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search input */}
      <div className="space-y-2">
        <Label htmlFor="presentation-search">
          Search for a presentation or enter its ID
        </Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="presentation-search"
            placeholder="Search presentations..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Search results */}
      {debouncedQuery.length >= 2 && (
        <div className="space-y-2">
          {searchResults.isLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching...
            </div>
          )}

          {searchResults.isError && (
            <p className="py-2 text-sm text-destructive">
              Search failed: {(searchResults.error as Error).message}
            </p>
          )}

          {searchResults.data && searchResults.data.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">
              No presentations found for &quot;{debouncedQuery}&quot;
            </p>
          )}

          {searchResults.data && searchResults.data.length > 0 && (
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-2">
              {searchResults.data.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onChange(item);
                    setSearchQuery("");
                    setDebouncedQuery("");
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                    value?.id === item.id && "bg-accent"
                  )}
                >
                  <Presentation className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.id}
                    </p>
                  </div>
                  {value?.id === item.id && (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create new button + dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full">
            <Plus className="h-4 w-4" />
            Create New Presentation
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Presentation</DialogTitle>
            <DialogDescription>
              Enter a name and the Google Drive folder ID where the presentation
              should be created.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-pres-name">Presentation Name</Label>
              <Input
                id="new-pres-name"
                placeholder="e.g. Q1 2026 Ad Concepts"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pres-folder">Folder ID</Label>
              <Input
                id="new-pres-folder"
                placeholder="Google Drive folder ID"
                value={newFolderId}
                onChange={(e) => setNewFolderId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The folder ID from the Google Drive URL where you want the
                presentation created.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
