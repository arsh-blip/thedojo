import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { MessagingDocument } from "../types.js";

export class GoogleDriveService {
  private drive;

  constructor(auth: OAuth2Client) {
    this.drive = google.drive({ version: "v3", auth });
  }

  async findMessagingDocument(
    brandName: string,
    folderName?: string
  ): Promise<{ id: string; name: string }[]> {
    const queries: string[] = [
      "mimeType != 'application/vnd.google-apps.folder'",
      "trashed = false",
    ];

    // Search by brand name in file name
    queries.push(`name contains '${brandName.replace(/'/g, "\\'")}'`);

    // Optionally scope to a folder
    if (folderName) {
      const folderResult = await this.drive.files.list({
        q: `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id, name)",
        pageSize: 1,
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
    });

    return (response.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
    }));
  }

  async getDocumentContent(fileId: string): Promise<string> {
    // First get file metadata to determine type
    const metadata = await this.drive.files.get({
      fileId,
      fields: "mimeType, name",
    });

    const mimeType = metadata.data.mimeType;

    // For Google Docs, export as plain text
    if (mimeType === "application/vnd.google-apps.document") {
      const response = await this.drive.files.export({
        fileId,
        mimeType: "text/plain",
      });
      return response.data as string;
    }

    // For Google Sheets, export as CSV
    if (mimeType === "application/vnd.google-apps.spreadsheet") {
      const response = await this.drive.files.export({
        fileId,
        mimeType: "text/csv",
      });
      return response.data as string;
    }

    // For JSON files, download directly
    if (
      mimeType === "application/json" ||
      metadata.data.name?.endsWith(".json")
    ) {
      const response = await this.drive.files.get(
        { fileId, alt: "media" },
        { responseType: "text" }
      );
      return response.data as string;
    }

    // For other text files, download directly
    const response = await this.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" }
    );
    return response.data as string;
  }

  async parseMessagingDocument(fileId: string): Promise<MessagingDocument> {
    const content = await this.getDocumentContent(fileId);

    // Try parsing as JSON first
    try {
      return JSON.parse(content) as MessagingDocument;
    } catch {
      // If not JSON, return a structured representation of the raw text
      // The LLM (Claude) will interpret this in the tool response
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
