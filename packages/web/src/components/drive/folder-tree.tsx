"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { drive, type DriveItem } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FolderTreeProps {
  selectedFolderId: string | undefined;
  onSelectFolder: (folderId: string, folderName: string) => void;
}

interface FolderNodeProps {
  folderId: string;
  name: string;
  depth: number;
  selectedFolderId: string | undefined;
  onSelectFolder: (folderId: string, folderName: string) => void;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

function FolderNode({
  folderId,
  name,
  depth,
  selectedFolderId,
  onSelectFolder,
}: FolderNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedFolderId === folderId;

  const { data, isLoading } = useQuery({
    queryKey: ["drive", "folder", folderId],
    queryFn: () => drive.listFolder(folderId),
    enabled: expanded,
  });

  const subfolders =
    data?.items.filter((item) => item.mimeType === FOLDER_MIME) ?? [];

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleSelect = useCallback(() => {
    onSelectFolder(folderId, name);
    if (!expanded) {
      setExpanded(true);
    }
  }, [folderId, name, onSelectFolder, expanded]);

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors",
          isSelected
            ? "bg-accent text-accent-foreground font-medium"
            : "text-foreground/80 hover:bg-accent/50"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <button
          type="button"
          onClick={handleToggle}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
          aria-label={expanded ? "Collapse folder" : "Expand folder"}
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-200",
              expanded && "rotate-90"
            )}
          />
        </button>
        <button
          type="button"
          onClick={handleSelect}
          className="flex flex-1 items-center gap-2 truncate text-left"
        >
          {expanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-blue-500" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-blue-500" />
          )}
          <span className="truncate">{name}</span>
        </button>
      </div>
      {expanded && (
        <div>
          {isLoading && (
            <div
              className="px-2 py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 12 + 28}px` }}
            >
              Loading...
            </div>
          )}
          {subfolders.map((subfolder) => (
            <FolderNode
              key={subfolder.id}
              folderId={subfolder.id}
              name={subfolder.name}
              depth={depth + 1}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
            />
          ))}
          {!isLoading && subfolders.length === 0 && expanded && data && (
            <div
              className="px-2 py-1 text-xs text-muted-foreground italic"
              style={{ paddingLeft: `${(depth + 1) * 12 + 28}px` }}
            >
              No subfolders
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FolderTree({
  selectedFolderId,
  onSelectFolder,
}: FolderTreeProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["drive", "folder", "root"],
    queryFn: () => drive.listFolder(),
  });

  const rootFolders =
    data?.items.filter((item) => item.mimeType === FOLDER_MIME) ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        <button
          type="button"
          onClick={() => onSelectFolder("", "My Drive")}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
            !selectedFolderId
              ? "bg-accent text-accent-foreground"
              : "text-foreground/80 hover:bg-accent/50"
          )}
        >
          <FolderOpen className="h-4 w-4 shrink-0 text-blue-500" />
          <span>My Drive</span>
        </button>

        {isLoading && (
          <div className="px-4 py-2 text-xs text-muted-foreground">
            Loading folders...
          </div>
        )}

        {rootFolders.map((folder) => (
          <FolderNode
            key={folder.id}
            folderId={folder.id}
            name={folder.name}
            depth={1}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
