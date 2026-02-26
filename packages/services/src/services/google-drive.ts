import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { MessagingDocument } from "../types.js";
import fs from "node:fs";
import path from "node:path";

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  modifiedTime?: string;
  webViewLink?: string;
}

export class GoogleDriveService {
  private drive;

  constructor(auth: OAuth2Client) {
    this.drive = google.drive({ version: "v3", auth });
  }

  // ── Folder Navigation ────────────────────────────────────────────

  async listFolder(folderId: string): Promise<DriveItem[]> {
    const response = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields:
        "files(id, name, mimeType, modifiedTime, webViewLink)",
      orderBy: "folder,name",
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return (response.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      isFolder: f.mimeType === "application/vnd.google-apps.folder",
      modifiedTime: f.modifiedTime || undefined,
      webViewLink: f.webViewLink || undefined,
    }));
  }

  async findFolderByName(
    name: string,
    parentId?: string
  ): Promise<DriveItem | null> {
    const queries = [
      `name = '${name.replace(/'/g, "\\'")}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
    ];
    if (parentId) {
      queries.push(`'${parentId}' in parents`);
    }

    const response = await this.drive.files.list({
      q: queries.join(" and "),
      fields: "files(id, name, mimeType, webViewLink)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const f = response.data.files?.[0];
    if (!f) return null;
    return {
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      isFolder: true,
      webViewLink: f.webViewLink || undefined,
    };
  }

  async getFileMetadata(fileId: string): Promise<DriveItem> {
    const response = await this.drive.files.get({
      fileId,
      fields: "id, name, mimeType, modifiedTime, webViewLink",
      supportsAllDrives: true,
    });
    const f = response.data;
    return {
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      isFolder: f.mimeType === "application/vnd.google-apps.folder",
      modifiedTime: f.modifiedTime || undefined,
      webViewLink: f.webViewLink || undefined,
    };
  }

  // ── Folder Creation ──────────────────────────────────────────────

  async createFolder(name: string, parentId: string): Promise<DriveItem> {
    const response = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      },
      fields: "id, name, mimeType, webViewLink",
      supportsAllDrives: true,
    });
    const f = response.data;
    return {
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      isFolder: true,
      webViewLink: f.webViewLink || undefined,
    };
  }

  async createClientFolderStructure(
    clientName: string,
    clientsRootId: string
  ): Promise<{
    clientFolder: DriveItem;
    creativeBriefs: DriveItem;
    creativeExports: DriveItem;
  }> {
    // Check if client folder already exists
    let clientFolder = await this.findFolderByName(
      clientName,
      clientsRootId
    );
    if (!clientFolder) {
      clientFolder = await this.createFolder(clientName, clientsRootId);
    }

    // Create subfolders
    let creativeBriefs = await this.findFolderByName(
      "Creative Briefs",
      clientFolder.id
    );
    if (!creativeBriefs) {
      creativeBriefs = await this.createFolder(
        "Creative Briefs",
        clientFolder.id
      );
    }

    let creativeExports = await this.findFolderByName(
      "Creative Exports",
      clientFolder.id
    );
    if (!creativeExports) {
      creativeExports = await this.createFolder(
        "Creative Exports",
        clientFolder.id
      );
    }

    return { clientFolder, creativeBriefs, creativeExports };
  }

  // ── File Creation ────────────────────────────────────────────────

  async createGoogleDoc(
    name: string,
    parentId: string,
    content?: string
  ): Promise<DriveItem> {
    const response = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.document",
        parents: [parentId],
      },
      fields: "id, name, mimeType, webViewLink",
      supportsAllDrives: true,
    });
    const f = response.data;

    // If content provided, update the doc
    if (content && f.id) {
      const docs = google.docs({
        version: "v1",
        auth: this.drive.context._options.auth as OAuth2Client,
      });
      await docs.documents.batchUpdate({
        documentId: f.id,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: content,
              },
            },
          ],
        },
      });
    }

    return {
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      isFolder: false,
      webViewLink: f.webViewLink || undefined,
    };
  }

  async createGoogleSheet(
    name: string,
    parentId: string
  ): Promise<DriveItem> {
    const response = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [parentId],
      },
      fields: "id, name, mimeType, webViewLink",
      supportsAllDrives: true,
    });
    const f = response.data;
    return {
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      isFolder: false,
      webViewLink: f.webViewLink || undefined,
    };
  }

  async createPresentation(
    name: string,
    parentId: string
  ): Promise<DriveItem> {
    const response = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.presentation",
        parents: [parentId],
      },
      fields: "id, name, mimeType, webViewLink",
      supportsAllDrives: true,
    });
    const f = response.data;
    return {
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      isFolder: false,
      webViewLink: f.webViewLink || undefined,
    };
  }

  async copyFile(
    sourceFileId: string,
    name: string,
    parentId: string
  ): Promise<DriveItem> {
    const response = await this.drive.files.copy({
      fileId: sourceFileId,
      requestBody: {
        name,
        parents: [parentId],
      },
      fields: "id, name, mimeType, webViewLink",
      supportsAllDrives: true,
    });
    const f = response.data;
    return {
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      isFolder: false,
      webViewLink: f.webViewLink || undefined,
    };
  }

  // ── File Download ───────────────────────────────────────────────

  /**
   * Get file size in bytes (returns 0 if unknown, e.g. Google Docs).
   */
  async getFileSize(fileId: string): Promise<number> {
    try {
      const res = await this.drive.files.get({
        fileId,
        fields: "size",
        supportsAllDrives: true,
      });
      return parseInt(res.data.size || "0", 10) || 0;
    } catch {
      return 0;
    }
  }

  async downloadFile(
    fileId: string,
    destPath: string,
    options?: {
      /** Timeout in ms for no-data received (default 5 min) */
      stallTimeout?: number;
      /** Called periodically with bytes downloaded so far */
      onProgress?: (bytesDownloaded: number) => void;
    }
  ): Promise<void> {
    const stallTimeout = options?.stallTimeout ?? 5 * 60 * 1000;

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const response = await this.drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" }
    );
    return new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(destPath);
      const stream = response.data as import("stream").Readable;
      let bytesDownloaded = 0;
      let settled = false;

      // Stall timer — resets every time data arrives
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            stream.destroy();
            dest.destroy();
            reject(new Error(`Download stalled — no data received for ${stallTimeout / 1000}s`));
          }
        }, stallTimeout);
      };
      resetStallTimer();

      stream.on("data", (chunk: Buffer) => {
        bytesDownloaded += chunk.length;
        resetStallTimer();
        options?.onProgress?.(bytesDownloaded);
      });

      stream.pipe(dest);

      dest.on("finish", () => {
        if (stallTimer) clearTimeout(stallTimer);
        if (!settled) { settled = true; resolve(); }
      });
      dest.on("error", (err) => {
        if (stallTimer) clearTimeout(stallTimer);
        if (!settled) { settled = true; reject(err); }
      });
      stream.on("error", (err) => {
        if (stallTimer) clearTimeout(stallTimer);
        if (!settled) { settled = true; reject(err); }
      });
    });
  }

  // ── Recursive Folder Listing ──────────────────────────────────

  async listFolderRecursive(
    folderId: string,
    basePath = ""
  ): Promise<(DriveItem & { relativePath: string })[]> {
    const items = await this.listFolder(folderId);
    const results: (DriveItem & { relativePath: string })[] = [];

    for (const item of items) {
      const itemPath = basePath ? `${basePath}/${item.name}` : item.name;
      if (item.isFolder) {
        const subItems = await this.listFolderRecursive(item.id, itemPath);
        results.push(...subItems);
      } else {
        results.push({ ...item, relativePath: itemPath });
      }
    }

    return results;
  }

  // ── Search ───────────────────────────────────────────────────────

  async searchFiles(
    query: string,
    parentId?: string
  ): Promise<DriveItem[]> {
    const queries = [
      `name contains '${query.replace(/'/g, "\\'")}'`,
      "trashed = false",
    ];
    if (parentId) {
      queries.push(`'${parentId}' in parents`);
    }

    const response = await this.drive.files.list({
      q: queries.join(" and "),
      fields:
        "files(id, name, mimeType, modifiedTime, webViewLink)",
      orderBy: "modifiedTime desc",
      pageSize: 20,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return (response.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      isFolder: f.mimeType === "application/vnd.google-apps.folder",
      modifiedTime: f.modifiedTime || undefined,
      webViewLink: f.webViewLink || undefined,
    }));
  }

  // ── Original methods (updated with supportsAllDrives) ────────────

  async findMessagingDocument(
    brandName: string,
    folderName?: string
  ): Promise<{ id: string; name: string }[]> {
    const queries: string[] = [
      "mimeType != 'application/vnd.google-apps.folder'",
      "trashed = false",
    ];

    queries.push(`name contains '${brandName.replace(/'/g, "\\'")}'`);

    if (folderName) {
      const folderResult = await this.drive.files.list({
        q: `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id, name)",
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      if (folderResult.data.files?.length) {
        queries.push(`'${folderResult.data.files[0].id}' in parents`);
      }
    }

    const response = await this.drive.files.list({
      q: queries.join(" and "),
      fields: "files(id, name, mimeType, modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return (response.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
    }));
  }

  async getDocumentContent(fileId: string): Promise<string> {
    const metadata = await this.drive.files.get({
      fileId,
      fields: "mimeType, name",
      supportsAllDrives: true,
    });

    const mimeType = metadata.data.mimeType;

    if (mimeType === "application/vnd.google-apps.document") {
      const response = await this.drive.files.export({
        fileId,
        mimeType: "text/plain",
      });
      return response.data as string;
    }

    if (mimeType === "application/vnd.google-apps.spreadsheet") {
      const response = await this.drive.files.export({
        fileId,
        mimeType: "text/csv",
      });
      return response.data as string;
    }

    if (
      mimeType === "application/json" ||
      metadata.data.name?.endsWith(".json")
    ) {
      const response = await this.drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "text" }
      );
      return response.data as string;
    }

    const response = await this.drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "text" }
    );
    return response.data as string;
  }

  async parseMessagingDocument(fileId: string): Promise<MessagingDocument> {
    const content = await this.getDocumentContent(fileId);

    try {
      return JSON.parse(content) as MessagingDocument;
    } catch {
      return {
        brand: "Unknown",
        angles: [],
        brand_voice: { tone: "", style: "", dos: [], donts: [] },
        key_benefits: [],
        target_demographics: [],
        _raw_content: content,
      } as MessagingDocument & { _raw_content: string };
    }
  }
}
