"use client";

import { type DriveItem } from "@/lib/api-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileText,
  FileVideo,
  Presentation,
  Image,
  File,
  Folder,
} from "lucide-react";

interface FileListProps {
  items: DriveItem[];
  isLoading: boolean;
  onNavigateFolder: (folderId: string, folderName: string) => void;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

function getIcon(mimeType: string) {
  if (mimeType === FOLDER_MIME) {
    return <Folder className="h-4 w-4 text-blue-500" />;
  }
  if (mimeType === "application/vnd.google-apps.presentation") {
    return <Presentation className="h-4 w-4 text-amber-500" />;
  }
  if (mimeType === "application/vnd.google-apps.document" || mimeType.includes("text") || mimeType.includes("pdf")) {
    return <FileText className="h-4 w-4 text-blue-400" />;
  }
  if (mimeType.startsWith("video/")) {
    return <FileVideo className="h-4 w-4 text-purple-500" />;
  }
  if (mimeType.startsWith("image/")) {
    return <Image className="h-4 w-4 text-green-500" />;
  }
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function getTypeLabel(mimeType: string): string {
  if (mimeType === FOLDER_MIME) return "Folder";
  if (mimeType === "application/vnd.google-apps.presentation") return "Presentation";
  if (mimeType === "application/vnd.google-apps.document") return "Document";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "Spreadsheet";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("video/")) return "Video";
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.startsWith("text/")) return "Text";
  return "File";
}

function formatDate(dateString?: string): string {
  if (!dateString) return "--";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatSize(sizeStr?: string): string {
  if (!sizeStr) return "--";
  const bytes = parseInt(sizeStr, 10);
  if (isNaN(bytes)) return "--";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function FileList({ items, isLoading, onNavigateFolder }: FileListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Loading files...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        This folder is empty.
      </div>
    );
  }

  // Sort: folders first, then files alphabetically
  const sorted = [...items].sort((a, b) => {
    const aIsFolder = a.mimeType === FOLDER_MIME ? 0 : 1;
    const bIsFolder = b.mimeType === FOLDER_MIME ? 0 : 1;
    if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder;
    return a.name.localeCompare(b.name);
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[50%]">Name</TableHead>
          <TableHead className="w-[15%]">Type</TableHead>
          <TableHead className="w-[20%]">Modified</TableHead>
          <TableHead className="w-[15%] text-right">Size</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((item) => {
          const isFolder = item.mimeType === FOLDER_MIME;
          return (
            <TableRow
              key={item.id}
              className={isFolder ? "cursor-pointer" : undefined}
              onClick={
                isFolder
                  ? () => onNavigateFolder(item.id, item.name)
                  : undefined
              }
            >
              <TableCell>
                <div className="flex items-center gap-2">
                  {getIcon(item.mimeType)}
                  <span
                    className={
                      isFolder
                        ? "font-medium hover:underline"
                        : undefined
                    }
                  >
                    {item.name}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {getTypeLabel(item.mimeType)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(item.modifiedTime)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatSize(item.size)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
