"use client";

import { useCallback, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, FileVideo, Loader2, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { video, type UploadResult } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface UploadZoneProps {
  onUploadComplete: (result: UploadResult) => void;
}

interface FileWithPath {
  file: File;
  relativePath: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isVideoFile(name: string): boolean {
  return /\.(mp4|mov)$/i.test(name);
}

export function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const [files, setFiles] = useState<FileWithPath[]>([]);
  const [uploading, setUploading] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles((prev) => {
      const existingPaths = new Set(prev.map((f) => f.relativePath));
      const newFiles: FileWithPath[] = acceptedFiles
        .filter((f) => {
          // Use webkitRelativePath if available (folder upload), else just name
          const relPath =
            (f as any).webkitRelativePath || (f as any).path || f.name;
          return !existingPaths.has(relPath);
        })
        .map((f) => ({
          file: f,
          relativePath:
            (f as any).webkitRelativePath || (f as any).path || f.name,
        }));
      return [...prev, ...newFiles];
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "video/mp4": [".mp4"],
      "video/quicktime": [".mov"],
    },
    disabled: uploading,
  });

  const handleFolderSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList) return;

      const videoFiles: FileWithPath[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (isVideoFile(file.name)) {
          videoFiles.push({
            file,
            relativePath: file.webkitRelativePath || file.name,
          });
        }
      }

      if (videoFiles.length === 0) {
        toast.error("No .mp4 or .mov files found in the selected folder");
        return;
      }

      setFiles((prev) => {
        const existingPaths = new Set(prev.map((f) => f.relativePath));
        const newFiles = videoFiles.filter(
          (f) => !existingPaths.has(f.relativePath)
        );
        return [...prev, ...newFiles];
      });

      toast.success(
        `Found ${videoFiles.length} video file${videoFiles.length !== 1 ? "s" : ""} in folder`
      );

      // Reset so the same folder can be selected again
      e.target.value = "";
    },
    []
  );

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      // Build FormData with relative paths preserved in filenames
      const formData = new FormData();
      files.forEach(({ file, relativePath }) => {
        // Send file with its relative path as the filename so the server
        // can reconstruct subfolder structure
        formData.append("files", file, relativePath);
      });

      const res = await fetch("/api/video/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Upload failed: ${res.status}`);
      }
      const result: UploadResult = await res.json();

      toast.success(`Uploaded ${files.length} file(s) successfully`);
      onUploadComplete(result);
      setFiles([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          "flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50",
          uploading && "pointer-events-none opacity-50"
        )}
      >
        <input {...getInputProps()} />
        <Upload className="mb-3 size-10 text-muted-foreground" />
        {isDragActive ? (
          <p className="text-sm font-medium">Drop your video files here</p>
        ) : (
          <>
            <p className="text-sm font-medium">
              Drag & drop video files here, or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Accepts .mp4 and .mov files
            </p>
          </>
        )}
      </div>

      {/* Folder upload button */}
      <div className="flex items-center gap-2">
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          onChange={handleFolderSelect}
          // @ts-expect-error webkitdirectory is not in React's type defs
          webkitdirectory=""
          directory=""
          multiple
        />
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => folderInputRef.current?.click()}
          disabled={uploading}
        >
          <FolderOpen className="size-4" />
          Select Folder (finds videos in subfolders)
        </Button>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {files.length} file{files.length !== 1 ? "s" : ""} selected
          </p>
          <ul className="max-h-[300px] space-y-1 overflow-y-auto">
            {files.map(({ file, relativePath }, index) => (
              <li
                key={`${relativePath}-${index}`}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <FileVideo className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm" title={relativePath}>
                    {relativePath}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(index);
                  }}
                  disabled={uploading}
                >
                  <X className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button
        onClick={handleUpload}
        disabled={files.length === 0 || uploading}
        className="w-full"
      >
        {uploading ? (
          <>
            <Loader2 className="animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Upload />
            Upload{" "}
            {files.length > 0
              ? `${files.length} File${files.length !== 1 ? "s" : ""}`
              : "Files"}
          </>
        )}
      </Button>
    </div>
  );
}
