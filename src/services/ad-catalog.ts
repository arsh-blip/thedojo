import fs from "node:fs/promises";
import type { VideoAdCatalog, VideoAdEntry } from "../types.js";

export interface CatalogSearchParams {
  search_text?: string;
  min_duration?: number;
  max_duration?: number;
  aspect_ratio?: string;
  has_captions?: boolean;
  caption_free_only?: boolean;
  scene_type?: string;
  limit?: number;
}

export class AdCatalogService {
  /**
   * Load an existing catalog from disk, or return null if it doesn't exist.
   */
  async load(catalogPath: string): Promise<VideoAdCatalog | null> {
    try {
      const raw = await fs.readFile(catalogPath, "utf-8");
      return JSON.parse(raw) as VideoAdCatalog;
    } catch {
      return null;
    }
  }

  /**
   * Save a catalog to disk.
   */
  async save(catalogPath: string, catalog: VideoAdCatalog): Promise<void> {
    await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf-8");
  }

  /**
   * Get set of already-analyzed filenames from an existing catalog.
   */
  getAnalyzedFilenames(catalog: VideoAdCatalog): Set<string> {
    return new Set(catalog.videos.map((v) => v.filename));
  }

  /**
   * Search and filter catalog entries.
   */
  search(
    catalog: VideoAdCatalog,
    params: CatalogSearchParams
  ): VideoAdEntry[] {
    let results = catalog.videos;

    if (params.search_text) {
      const query = params.search_text.toLowerCase();
      results = results.filter(
        (v) =>
          v.filename.toLowerCase().includes(query) ||
          (v.transcript && v.transcript.toLowerCase().includes(query))
      );
    }

    if (params.min_duration !== undefined) {
      results = results.filter(
        (v) => v.duration_seconds >= params.min_duration!
      );
    }

    if (params.max_duration !== undefined) {
      results = results.filter(
        (v) => v.duration_seconds <= params.max_duration!
      );
    }

    if (params.aspect_ratio) {
      results = results.filter((v) => v.aspect_ratio === params.aspect_ratio);
    }

    if (params.has_captions !== undefined) {
      results = results.filter((v) => {
        if (!v.frame_analyses) return false; // skip videos without visual analysis
        const anyCaption = v.frame_analyses.some((f) => f.has_text_overlay);
        return params.has_captions ? anyCaption : !anyCaption;
      });
    }

    if (params.caption_free_only) {
      results = results.filter(
        (v) => v.caption_free_segments && v.caption_free_segments.length > 0
      );
    }

    if (params.scene_type) {
      results = results.filter((v) => {
        if (!v.frame_analyses) return false;
        return v.frame_analyses.some((f) => f.scene_type === params.scene_type);
      });
    }

    if (params.limit !== undefined && params.limit > 0) {
      results = results.slice(0, params.limit);
    }

    return results;
  }

  /**
   * Format a video entry for display.
   */
  formatEntry(entry: VideoAdEntry): string {
    const lines = [
      `**${entry.filename}**`,
      `- Duration: ${entry.duration_seconds}s | Aspect: ${entry.aspect_ratio} | Resolution: ${entry.resolution.width}x${entry.resolution.height}`,
      `- Size: ${(entry.file_size_bytes / (1024 * 1024)).toFixed(1)} MB`,
      `- Key frames: ${entry.key_frame_paths.length} extracted`,
    ];

    if (entry.transcript) {
      const preview =
        entry.transcript.length > 300
          ? entry.transcript.slice(0, 300) + "..."
          : entry.transcript;
      lines.push(`- Transcript: "${preview}"`);
    } else {
      lines.push(`- Transcript: (no speech detected)`);
    }

    // Visual analysis details
    if (entry.frame_analyses && entry.frame_analyses.length > 0) {
      const withCaptions = entry.frame_analyses.filter(
        (f) => f.has_text_overlay
      ).length;
      const sceneTypes = [
        ...new Set(entry.frame_analyses.map((f) => f.scene_type)),
      ];

      lines.push(
        `- Visual analysis: ${entry.frame_analyses.length} frames analyzed`
      );
      lines.push(
        `- Text overlays: ${withCaptions}/${entry.frame_analyses.length} frames have captions`
      );
      lines.push(`- Scene types: ${sceneTypes.join(", ")}`);

      // Frame-by-frame breakdown
      for (const frame of entry.frame_analyses) {
        const captionTag = frame.has_text_overlay
          ? ` [CAPTION: "${frame.detected_text}"]`
          : " [NO CAPTION]";
        lines.push(
          `  - @${frame.timestamp_seconds}s (${frame.scene_type}): ${frame.description}${captionTag}`
        );
      }
    }

    // Caption-free segments
    if (entry.caption_free_segments && entry.caption_free_segments.length > 0) {
      lines.push(`- Caption-free segments (clip-ready):`);
      for (const seg of entry.caption_free_segments) {
        const duration = Math.round(
          (seg.end_seconds - seg.start_seconds) * 10
        ) / 10;
        lines.push(
          `  - ${seg.start_seconds}s–${seg.end_seconds}s (${duration}s, ${seg.frame_count} frames): ${seg.description}`
        );
      }
    }

    return lines.join("\n");
  }

  /**
   * Generate a summary of the full catalog.
   */
  summarize(catalog: VideoAdCatalog): string {
    const totalSize = catalog.videos.reduce(
      (sum, v) => sum + v.file_size_bytes,
      0
    );
    const totalDuration = catalog.videos.reduce(
      (sum, v) => sum + v.duration_seconds,
      0
    );
    const withTranscript = catalog.videos.filter((v) => v.transcript).length;

    const aspectCounts: Record<string, number> = {};
    for (const v of catalog.videos) {
      aspectCounts[v.aspect_ratio] =
        (aspectCounts[v.aspect_ratio] ?? 0) + 1;
    }

    const aspectBreakdown = Object.entries(aspectCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([ratio, count]) => `${ratio}: ${count}`)
      .join(", ");

    const withVisualAnalysis = catalog.videos.filter(
      (v) => v.frame_analyses && v.frame_analyses.length > 0
    ).length;
    const withCaptionFreeSegs = catalog.videos.filter(
      (v) => v.caption_free_segments && v.caption_free_segments.length > 0
    ).length;

    const summaryLines = [
      `## Ad Catalog: ${catalog.brand}`,
      `- **Videos:** ${catalog.videos.length}`,
      `- **Total size:** ${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`,
      `- **Total duration:** ${Math.round(totalDuration / 60)} minutes (${Math.round(totalDuration)}s)`,
      `- **With transcripts:** ${withTranscript}/${catalog.videos.length}`,
      `- **Aspect ratios:** ${aspectBreakdown}`,
      `- **Source:** ${catalog.source_folder}`,
      `- **Last updated:** ${catalog.updated_at}`,
    ];

    if (withVisualAnalysis > 0) {
      summaryLines.push(
        `- **Visual analysis:** ${withVisualAnalysis}/${catalog.videos.length} videos`
      );
      summaryLines.push(
        `- **With caption-free clips:** ${withCaptionFreeSegs}/${catalog.videos.length} videos`
      );
    }

    return summaryLines.join("\n");
  }
}
