import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import type { VideoAdEntry } from "../types.js";

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
   * Analyze a single video: extract metadata, key frames, and transcript.
   */
  async analyzeVideo(
    filePath: string,
    framesDir: string,
    options: AnalyzeOptions
  ): Promise<VideoAdEntry> {
    const meta = await this.getVideoMetadata(filePath);
    const keyFrames = await this.extractKeyFrames(
      filePath,
      framesDir,
      options
    );
    const transcript = await this.transcribeVideo(filePath);

    return {
      filename: path.basename(filePath),
      file_path: filePath,
      file_size_bytes: meta.sizeBytes,
      duration_seconds: Math.round(meta.duration * 10) / 10,
      resolution: { width: meta.width, height: meta.height },
      aspect_ratio: this.getAspectRatio(meta.width, meta.height),
      transcript,
      key_frame_paths: keyFrames,
      analyzed_at: new Date().toISOString(),
    };
  }
}
