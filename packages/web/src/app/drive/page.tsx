"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { drive } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { FolderTree } from "@/components/drive/folder-tree";
import { FileList } from "@/components/drive/file-list";
import { CreateDialog } from "@/components/drive/create-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronRight,
  FolderOpen,
  Plus,
  Search,
} from "lucide-react";

interface BreadcrumbEntry {
  id: string;
  name: string;
}

export default function DrivePage() {
  const [currentFolderId, setCurrentFolderId] = useState<string>("");
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([
    { id: "", name: "My Drive" },
  ]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");

  const {
    data: folderData,
    isLoading: isFolderLoading,
  } = useQuery({
    queryKey: ["drive", "folder", currentFolderId || "root"],
    queryFn: () => drive.listFolder(currentFolderId || undefined),
  });

  const {
    data: searchResults,
    isLoading: isSearchLoading,
  } = useQuery({
    queryKey: ["drive", "search", activeSearch, currentFolderId],
    queryFn: () =>
      drive.search(activeSearch, currentFolderId || undefined),
    enabled: activeSearch.length > 0,
  });

  const isSearchActive = activeSearch.length > 0;
  const displayItems = isSearchActive
    ? searchResults ?? []
    : folderData?.items ?? [];
  const isLoading = isSearchActive ? isSearchLoading : isFolderLoading;

  const navigateToFolder = useCallback(
    (folderId: string, folderName: string) => {
      setActiveSearch("");
      setSearchQuery("");
      setCurrentFolderId(folderId);

      if (!folderId) {
        setBreadcrumbs([{ id: "", name: "My Drive" }]);
        return;
      }

      setBreadcrumbs((prev) => {
        const existingIndex = prev.findIndex((b) => b.id === folderId);
        if (existingIndex >= 0) {
          return prev.slice(0, existingIndex + 1);
        }
        return [...prev, { id: folderId, name: folderName }];
      });
    },
    []
  );

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setActiveSearch(searchQuery.trim());
    },
    [searchQuery]
  );

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setActiveSearch("");
  }, []);

  return (
    <>
      <Header
        title="Drive"
        description="Browse client folders and files"
        actions={
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Create
          </Button>
        }
      />

      <div className="flex h-[calc(100vh-73px)]">
        {/* Left panel - Folder tree */}
        <aside className="w-64 shrink-0 border-r">
          <div className="flex h-10 items-center border-b px-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Folders
            </span>
          </div>
          <div className="h-[calc(100%-40px)]">
            <FolderTree
              selectedFolderId={currentFolderId}
              onSelectFolder={navigateToFolder}
            />
          </div>
        </aside>

        {/* Right panel - File listing */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Toolbar: breadcrumbs + search */}
          <div className="flex items-center justify-between gap-4 border-b px-4 py-2">
            {/* Breadcrumbs */}
            <nav className="flex items-center gap-1 text-sm min-w-0">
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.id + index} className="flex items-center gap-1 min-w-0">
                  {index > 0 && (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {index === breadcrumbs.length - 1 ? (
                    <span className="flex items-center gap-1.5 font-medium truncate">
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                      {crumb.name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigateToFolder(crumb.id, crumb.name)}
                      className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground truncate transition-colors"
                    >
                      {crumb.name}
                    </button>
                  )}
                </span>
              ))}
            </nav>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-56 pl-8 text-sm"
                />
              </div>
              {isSearchActive && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={clearSearch}
                >
                  Clear
                </Button>
              )}
            </form>
          </div>

          {/* Search indicator */}
          {isSearchActive && (
            <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
              <Search className="h-3 w-3" />
              <span>
                Search results for &quot;{activeSearch}&quot;
                {searchResults && ` (${searchResults.length} items)`}
              </span>
            </div>
          )}

          {/* File list */}
          <ScrollArea className="flex-1">
            <div className="p-4">
              <FileList
                items={displayItems}
                isLoading={isLoading}
                onNavigateFolder={navigateToFolder}
              />
            </div>
          </ScrollArea>
        </div>
      </div>

      <CreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        currentFolderId={currentFolderId}
      />
    </>
  );
}
