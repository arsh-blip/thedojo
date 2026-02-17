import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import type {
  VideoAdEntry,
  FrameAnalysis,
  CaptionFreeSegment,
} from "../types.js";

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  ".mkv",
  ".m4v",
]);

interface AnalyzeOptions {
  frameIntervalSeconds: number;
  maxFramesPerVideo: number;
}

export class VideoAnalyzerService {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * List all video files in a flat folder.
   */
  async listVideos(folderPath: string): Promise<string[]> {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isFile() && VIDEO_EXTENSIONS.has(path.extname(e.name).toLowerCase())
      )
      .map((e) => path.join(folderPath, e.name))
      .sort();
  }

  /**
   * Extract video metadata using ffprobe.
   */
  async getVideoMetadata(
    filePath: string
  ): Promise<{
    duration: number;
    width: number;
    height: number;
    sizeBytes: number;
  }> {
    const stat = await fs.stat(filePath);

    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);

    const probe = JSON.parse(stdout);
    const videoStream = probe.streams?.find(
      (s: { codec_type: string }) => s.codec_type === "video"
    );

    return {
      duration: parseFloat(probe.format?.duration ?? "0"),
      width: videoStream?.width ?? 0,
      height: videoStream?.height ?? 0,
      sizeBytes: stat.size,
    };
  }

  /**
   * Compute a human-readable aspect ratio string.
   */
  getAspectRatio(width: number, height: number): string {
    if (width === 0 || height === 0) return "unknown";
    const ratio = width / height;
    if (Math.abs(ratio - 16 / 9) < 0.1) return "16:9";
    if (Math.abs(ratio - 9 / 16) < 0.1) return "9:16";
    if (Math.abs(ratio - 4 / 5) < 0.1) return "4:5";
    if (Math.abs(ratio - 1) < 0.1) return "1:1";
    return `${width}:${height}`;
  }

  /**
   * Extract key frames from a video at regular intervals.
   * Saves frames as JPEG files in a subfolder next to the video.
   */
  async extractKeyFrames(
    filePath: string,
    outputDir: string,
    options: AnalyzeOptions
  ): Promise<string[]> {
    const baseName = path.basename(filePath, path.extname(filePath));
    const frameDir = path.join(outputDir, baseName);
    await fs.mkdir(frameDir, { recursive: true });

    const outputPattern = path.join(frameDir, "frame_%03d.jpg");

    await execFileAsync("ffmpeg", [
      "-i",
      filePath,
      "-vf",
      `fps=1/${options.frameIntervalSeconds}`,
      "-frames:v",
      String(options.maxFramesPerVideo),
      "-q:v",
      "2",
      "-y",
      outputPattern,
    ]);

    // List the generated frames
    const files = await fs.readdir(frameDir);
    return files
      .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
      .sort()
      .map((f) => path.join(frameDir, f));
  }

  /**
   * Extract audio from video and transcribe using OpenAI Whisper API.
   * Returns null if the video has no audio track or transcription fails.
   */
  async transcribeVideo(filePath: string): Promise<string | null> {
    const tmpAudio = filePath.replace(path.extname(filePath), "_audio.mp3");

    try {
      // Extract audio as compressed MP3 (64kbps mono — keeps file small)
      await execFileAsync("ffmpeg", [
        "-i",
        filePath,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-b:a",
        "64k",
        "-ac",
        "1",
        "-y",
        tmpAudio,
      ]);

      // Check file exists and has content
      const stat = await fs.stat(tmpAudio);
      if (stat.size < 1000) {
        // Less than 1KB — likely silence or no audio
        return null;
      }

      const transcription = await this.openai.audio.transcriptions.create({
        file: createReadStream(tmpAudio),
        model: "whisper-1",
        response_format: "text",
      });

      return typeof transcription === "string"
        ? transcription.trim()
        : (transcription as unknown as { text: string }).text?.trim() ?? null;
    } catch {
      // Video may have no audio track, or transcription may fail
      return null;
    } finally {
      // Clean up temp audio file
      await fs.unlink(tmpAudio).catch(() => {});
    }
  }

  /**
   * Analyze a single frame using OpenAI GPT-4o vision.
   * Detects scene content, text overlays / burned-in captions, and scene type.
   */
  async analyzeFrame(
    framePath: string,
    timestampSeconds: number
  ): Promise<FrameAnalysis> {
    const imageBuffer = await fs.readFile(framePath);
    const base64Image = imageBuffer.toString("base64");
    const mimeType = "image/jpeg";

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this video ad frame. Respond with ONLY valid JSON, no markdown:
{
  "description": "Brief description of what's shown (1-2 sentences)",
  "has_text_overlay": true/false (is there any burned-in text, captions, subtitles, or text overlay visible?),
  "detected_text": "exact text shown on screen" or null if none,
  "scene_type": one of: "product_shot", "lifestyle", "ugc_talking_head", "text_card", "logo_endcard", "unboxing", "before_after", "testimonial", "demo", "other"
}`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: "low",
              },
            },
          ],
        },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "{}";

    try {
      const parsed = JSON.parse(raw);
      return {
        frame_path: framePath,
        timestamp_seconds: timestampSeconds,
        description: parsed.description ?? "Unable to analyze",
        has_text_overlay: parsed.has_text_overlay ?? false,
        detected_text: parsed.detected_text ?? null,
        scene_type: parsed.scene_type ?? "other",
      };
    } catch {
      return {
        frame_path: framePath,
        timestamp_seconds: timestampSeconds,
        description: raw.slice(0, 200),
        has_text_overlay: false,
        detected_text: null,
        scene_type: "other",
      };
    }
  }

  /**
   * Analyze all extracted frames for visual content and caption detection.
   */
  async analyzeFrames(
    framePaths: string[],
    frameIntervalSeconds: number
  ): Promise<FrameAnalysis[]> {
    const analyses: FrameAnalysis[] = [];

    for (let i = 0; i < framePaths.length; i++) {
      const timestamp = i * frameIntervalSeconds;
      try {
        const analysis = await this.analyzeFrame(framePaths[i], timestamp);
        analyses.push(analysis);
      } catch {
        analyses.push({
          frame_path: framePaths[i],
          timestamp_seconds: timestamp,
          description: "Analysis failed",
          has_text_overlay: false,
          detected_text: null,
          scene_type: "other",
        });
      }
    }

    return analyses;
  }

  /**
   * Compute contiguous segments where no text overlay / captions were detected.
   * These are ideal for clipping and repurposing without needing to hide captions.
   */
  computeCaptionFreeSegments(
    analyses: FrameAnalysis[],
    frameIntervalSeconds: number,
    totalDuration: number
  ): CaptionFreeSegment[] {
    if (analyses.length === 0) return [];

    const segments: CaptionFreeSegment[] = [];
    let segStart: number | null = null;
    let segFrameCount = 0;
    const descriptions: string[] = [];

    for (const frame of analyses) {
      if (!frame.has_text_overlay) {
        if (segStart === null) {
          segStart = frame.timestamp_seconds;
          segFrameCount = 0;
          descriptions.length = 0;
        }
        segFrameCount++;
        descriptions.push(frame.description);
      } else {
        // Text detected — close any open segment
        if (segStart !== null) {
          const lastCleanTimestamp =
            segStart + (segFrameCount - 1) * frameIntervalSeconds;
          segments.push({
            start_seconds: segStart,
            end_seconds: Math.min(
              lastCleanTimestamp + frameIntervalSeconds,
              totalDuration
            ),
            frame_count: segFrameCount,
            description: descriptions.slice(0, 3).join("; "),
          });
          segStart = null;
        }
      }
    }

    // Close final segment if it extends to the end
    if (segStart !== null) {
      segments.push({
        start_seconds: segStart,
        end_seconds: totalDuration,
        frame_count: segFrameCount,
        description: descriptions.slice(0, 3).join("; "),
      });
    }

    return segments;
  }

  /**
   * Analyze a single video: extract metadata, key frames, transcript,
   * and optionally run visual frame analysis for caption detection.
   */
  async analyzeVideo(
    filePath: string,
    framesDir: string,
    options: AnalyzeOptions & { analyzeVisuals?: boolean }
  ): Promise<VideoAdEntry> {
    const meta = await this.getVideoMetadata(filePath);
    const keyFrames = await this.extractKeyFrames(
      filePath,
      framesDir,
      options
    );
    const transcript = await this.transcribeVideo(filePath);

    let frameAnalyses: FrameAnalysis[] | null = null;
    let captionFreeSegments: CaptionFreeSegment[] | null = null;

    if (options.analyzeVisuals && keyFrames.length > 0) {
      frameAnalyses = await this.analyzeFrames(
        keyFrames,
        options.frameIntervalSeconds
      );
      captionFreeSegments = this.computeCaptionFreeSegments(
        frameAnalyses,
        options.frameIntervalSeconds,
        Math.round(meta.duration * 10) / 10
      );
    }

    return {
      filename: path.basename(filePath),
      file_path: filePath,
      file_size_bytes: meta.sizeBytes,
      duration_seconds: Math.round(meta.duration * 10) / 10,
      resolution: { width: meta.width, height: meta.height },
      aspect_ratio: this.getAspectRatio(meta.width, meta.height),
      transcript,
      key_frame_paths: keyFrames,
      frame_analyses: frameAnalyses,
      caption_free_segments: captionFreeSegments,
      analyzed_at: new Date().toISOString(),
    };
  }
}
