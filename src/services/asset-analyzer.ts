import * as fs from "fs/promises";
import * as path from "path";
import type {
  AssetAnalysisResult,
  AssetFileType,
  AdSpecCheck,
} from "../types.js";

// ── MIME / extension mapping ────────────────────────────────────────

const EXTENSION_TO_MIME: Record<string, string> = {
  // Video
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".gif": "image/gif", // treated as image but can be animated
  // Image
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".svg": "image/svg+xml",
  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  // Document
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".psd": "image/vnd.adobe.photoshop",
  ".ai": "application/postscript",
};

function mimeFromExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return EXTENSION_TO_MIME[ext] || "application/octet-stream";
}

function fileTypeFromMime(mime: string): AssetFileType {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (
    mime.startsWith("text/") ||
    mime === "application/pdf" ||
    mime === "application/json" ||
    mime.includes("document") ||
    mime.includes("spreadsheet")
  ) {
    return "document";
  }
  return "other";
}

// ── Image dimension reading (lightweight, no deps) ──────────────────

async function readImageDimensions(
  filePath: string,
  mime: string
): Promise<{ width: number; height: number } | undefined> {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buf = Buffer.alloc(32);
      await handle.read(buf, 0, 32, 0);

      // PNG: width at bytes 16-19, height at bytes 20-23 (big-endian)
      if (mime === "image/png") {
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        return { width, height };
      }

      // JPEG: need to walk markers to find SOF
      if (mime === "image/jpeg") {
        return await readJpegDimensions(handle);
      }
    } finally {
      await handle.close();
    }
  } catch {
    // Non-critical — return undefined if we can't read dimensions
  }
  return undefined;
}

async function readJpegDimensions(
  handle: fs.FileHandle
): Promise<{ width: number; height: number } | undefined> {
  // Walk JPEG markers looking for SOF0 (0xFFC0) through SOF2 (0xFFC2)
  let offset = 2; // skip SOI marker
  const markerBuf = Buffer.alloc(10);

  for (let i = 0; i < 100; i++) {
    // safety limit
    const { bytesRead } = await handle.read(markerBuf, 0, 4, offset);
    if (bytesRead < 4) break;

    const marker = markerBuf.readUInt16BE(0);
    const length = markerBuf.readUInt16BE(2);

    // SOF markers: 0xFFC0-0xFFC3, 0xFFC5-0xFFC7, 0xFFC9-0xFFCB, 0xFFCD-0xFFCF
    if (marker >= 0xffc0 && marker <= 0xffcf && marker !== 0xffc4 && marker !== 0xffc8) {
      const sofBuf = Buffer.alloc(5);
      await handle.read(sofBuf, 0, 5, offset + 2);
      // SOF: precision(1) + height(2) + width(2)
      const height = sofBuf.readUInt16BE(1);
      const width = sofBuf.readUInt16BE(3);
      return { width, height };
    }

    offset += 2 + length;
  }
  return undefined;
}

// ── Meta Ad Spec Compliance ─────────────────────────────────────────

const META_IMAGE_SPECS = {
  maxSizeBytes: 30 * 1024 * 1024, // 30 MB
  supportedFormats: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  recommendedAspectRatios: ["1:1", "4:5", "9:16", "16:9", "1.91:1"],
  minWidth: 600,
};

const META_VIDEO_SPECS = {
  maxSizeBytes: 4 * 1024 * 1024 * 1024, // 4 GB
  maxDurationSeconds: 14400, // 240 minutes
  supportedFormats: [
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "image/gif",
  ],
  recommendedAspectRatios: ["1:1", "4:5", "9:16", "16:9"],
};

function checkAdSpecs(
  fileType: AssetFileType,
  mime: string,
  fileSize: number,
  dimensions?: { width: number; height: number }
): AdSpecCheck[] {
  const checks: AdSpecCheck[] = [];

  if (fileType === "image") {
    // Format check
    const formatOk = META_IMAGE_SPECS.supportedFormats.includes(mime);
    checks.push({
      spec: "Meta image format",
      passed: formatOk,
      message: formatOk
        ? `${mime} is a supported image format`
        : `${mime} is not a supported Meta ad image format (use JPG, PNG, WebP, or GIF)`,
    });

    // Size check
    const sizeOk = fileSize <= META_IMAGE_SPECS.maxSizeBytes;
    checks.push({
      spec: "Meta image file size (max 30MB)",
      passed: sizeOk,
      message: sizeOk
        ? `${formatBytes(fileSize)} is within the 30MB limit`
        : `${formatBytes(fileSize)} exceeds the 30MB limit`,
    });

    // Dimension check
    if (dimensions) {
      const widthOk = dimensions.width >= META_IMAGE_SPECS.minWidth;
      checks.push({
        spec: "Meta image minimum width (600px)",
        passed: widthOk,
        message: widthOk
          ? `${dimensions.width}px width meets the 600px minimum`
          : `${dimensions.width}px width is below the 600px minimum`,
      });

      const ratio = computeAspectRatio(dimensions.width, dimensions.height);
      checks.push({
        spec: "Meta image aspect ratio",
        passed: true, // informational
        message: `Aspect ratio is ${ratio} (recommended: 1:1, 4:5, 9:16, 16:9, or 1.91:1)`,
      });
    }
  }

  if (fileType === "video") {
    // Format check
    const formatOk = META_VIDEO_SPECS.supportedFormats.includes(mime);
    checks.push({
      spec: "Meta video format",
      passed: formatOk,
      message: formatOk
        ? `${mime} is a supported video format`
        : `${mime} is not a supported Meta ad video format (use MP4, MOV, WebM, or GIF)`,
    });

    // Size check
    const sizeOk = fileSize <= META_VIDEO_SPECS.maxSizeBytes;
    checks.push({
      spec: "Meta video file size (max 4GB)",
      passed: sizeOk,
      message: sizeOk
        ? `${formatBytes(fileSize)} is within the 4GB limit`
        : `${formatBytes(fileSize)} exceeds the 4GB limit`,
    });
  }

  // Generic format support tag for non-ad types
  if (fileType !== "image" && fileType !== "video") {
    checks.push({
      spec: "Meta ad format",
      passed: false,
      message: `${fileType} files are not directly usable as Meta ad creatives`,
    });
  }

  return checks;
}

// ── Utilities ───────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function computeAspectRatio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}

function generateTags(
  fileType: AssetFileType,
  mime: string,
  fileSize: number,
  filename: string,
  dimensions?: { width: number; height: number }
): string[] {
  const tags: string[] = [fileType];
  const ext = path.extname(filename).toLowerCase().replace(".", "");
  if (ext) tags.push(ext);

  if (fileType === "image") {
    if (dimensions) {
      if (dimensions.width === dimensions.height) tags.push("square", "1:1");
      else if (dimensions.width > dimensions.height) tags.push("landscape");
      else tags.push("portrait");

      if (dimensions.width >= 1080) tags.push("high-res");
    }
    if (mime === "image/gif") tags.push("animated-candidate");
  }

  if (fileType === "video") {
    if (fileSize > 100 * 1024 * 1024) tags.push("large-file");
    if (mime === "video/mp4") tags.push("meta-compatible");
    if (mime === "video/quicktime") tags.push("meta-compatible");
  }

  return tags;
}

// ── Public API ──────────────────────────────────────────────────────

export class AssetAnalyzer {
  /**
   * Analyze a local file: extract metadata, check ad specs, generate tags.
   */
  async analyzeLocalFile(
    filePath: string,
    assetId: string
  ): Promise<AssetAnalysisResult> {
    const filename = path.basename(filePath);
    const stat = await fs.stat(filePath);
    const fileSize = stat.size;
    const mime = mimeFromExtension(filename);
    const fileType = fileTypeFromMime(mime);

    // Try to read image dimensions
    let dimensions: { width: number; height: number } | undefined;
    if (fileType === "image") {
      dimensions = await readImageDimensions(filePath, mime);
    }

    const adSpecCompliance = checkAdSpecs(fileType, mime, fileSize, dimensions);
    const tags = generateTags(fileType, mime, fileSize, filename, dimensions);

    const summary = buildSummary(
      filename,
      fileType,
      mime,
      fileSize,
      dimensions,
      adSpecCompliance
    );

    return {
      assetId,
      filename,
      fileType,
      mimeType: mime,
      fileSize,
      dimensions,
      adSpecCompliance,
      tags,
      summary,
    };
  }

  /**
   * Analyze a Google Drive file from its metadata (no download needed for basic analysis).
   */
  analyzeFromDriveMetadata(
    fileId: string,
    filename: string,
    mimeType: string,
    fileSize: number,
    assetId: string
  ): AssetAnalysisResult {
    const mime = mimeType || mimeFromExtension(filename);
    const fileType = fileTypeFromMime(mime);
    const adSpecCompliance = checkAdSpecs(fileType, mime, fileSize);
    const tags = generateTags(fileType, mime, fileSize, filename);

    const summary = buildSummary(
      filename,
      fileType,
      mime,
      fileSize,
      undefined,
      adSpecCompliance
    );

    return {
      assetId,
      filename,
      fileType,
      mimeType: mime,
      fileSize,
      adSpecCompliance,
      tags,
      summary,
    };
  }
}

function buildSummary(
  filename: string,
  fileType: AssetFileType,
  mime: string,
  fileSize: number,
  dimensions?: { width: number; height: number },
  checks?: AdSpecCheck[]
): string {
  const parts: string[] = [
    `${filename}: ${fileType} (${mime}), ${formatBytes(fileSize)}`,
  ];

  if (dimensions) {
    parts.push(`Dimensions: ${dimensions.width}x${dimensions.height}`);
  }

  if (checks?.length) {
    const failed = checks.filter((c) => !c.passed);
    if (failed.length === 0) {
      parts.push("Ad spec compliance: all checks passed");
    } else {
      parts.push(
        `Ad spec issues: ${failed.map((c) => c.message).join("; ")}`
      );
    }
  }

  return parts.join(". ");
}
