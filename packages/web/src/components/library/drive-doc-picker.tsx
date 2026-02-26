"use client";

import { useState, useEffect } from "react";
import { drive, type DriveItem } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, X, Search, Loader2 } from "lucide-react";

interface DriveDocPickerProps {
  selectedFileId?: string;
  selectedFileName?: string;
  onSelect: (fileId: string, fileName: string) => void;
  onClear: () => void;
}

export function DriveDocPicker({
  selectedFileId,
  selectedFileName,
  onSelect,
  onClear,
}: DriveDocPickerProps) {
  const [searchMode, setSearchMode] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounce the search query by 400ms
  useEffect(() => {
    if (!query.trim()) {
      setDebouncedQuery("");
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  // Fetch results when debounced query changes
  useEffect(() => {
    if (!debouncedQuery) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    drive
      .search(debouncedQuery)
      .then((items) => {
        if (cancelled) return;
        const filtered = items.filter(
          (item) =>
            item.mimeType.includes("document") ||
            item.mimeType.includes("spreadsheet") ||
            item.mimeType.includes("csv")
        );
        setResults(filtered);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  function handleSelect(item: DriveItem) {
    onSelect(item.id, item.name);
    setSearchMode(false);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
  }

  function handleChange() {
    setSearchMode(true);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
  }

  // Selected state: show the linked doc
  if (selectedFileId && !searchMode) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-sm font-medium">
            {selectedFileName || selectedFileId}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClear}
            title="Unlink document"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={handleChange}
        >
          Change
        </Button>
      </div>
    );
  }

  // Search mode
  if (searchMode || selectedFileId) {
    return (
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search Google Drive..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching...
          </div>
        )}

        {!loading && debouncedQuery && results.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">
            No documents found for &quot;{debouncedQuery}&quot;
          </p>
        )}

        {results.length > 0 && (
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{item.name}</span>
              </button>
            ))}
          </div>
        )}

        {!selectedFileId && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setSearchMode(false)}
          >
            Cancel
          </Button>
        )}
      </div>
    );
  }

  // Empty state: no doc selected, not searching
  return (
    <Button
      variant="outline"
      size="sm"
      className="text-muted-foreground"
      onClick={() => setSearchMode(true)}
    >
      <FileText className="h-4 w-4" />
      Link Messaging Doc
    </Button>
  );
}
