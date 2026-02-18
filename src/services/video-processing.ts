import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import type { VideoMetadata, ExtractedFrame, SceneSegment } from "../types.js";

const execFileAsync = promisify(execFile);

export interface VideoProcessingResult {
  videoId: string;
  videoPath: string;
  metadata: VideoMetadata;
  sessionDir: string;
}

// In-memory store for ingested videos so subsequent tools can access them
const videoStore = new Map<
  string,
  { videoPath: string; metadata: VideoMetadata; sessionDir: string }
>();

export function getStoredVideo(videoId: string) {
  return videoStore.get(videoId);
}

export class VideoProcessingService {
  private baseDir: string;

  constructor() {
    this.baseDir = path.join(os.tmpdir(), "fb-ad-video-analysis");
  }

  private async createSessionDir(): Promise<{ id: string; dir: string }> {
    const id = crypto.randomUUID();
    const dir = path.join(this.baseDir, id);
    await fs.mkdir(dir, { recursive: true });
    return { id, dir };
  }

  async ingestFromUrl(url: string): Promise<VideoProcessingResult> {
    const { id, dir } = await this.createSessionDir();
    const videoPath = path.join(dir, "source.mp4");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to download video: ${response.status} ${response.statusText}`
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(videoPath, buffer);

    const metadata = await this.getMetadata(videoPath);
    videoStore.set(id, { videoPath, metadata, sessionDir: dir });
    return { videoId: id, videoPath, metadata, sessionDir: dir };
  }

  async ingestFromLocal(localPath: string): Promise<VideoProcessingResult> {
    // Verify file exists
    await fs.access(localPath);

    const { id, dir } = await this.createSessionDir();
    const videoPath = path.join(dir, `source${path.extname(localPath)}`);
    await fs.copyFile(localPath, videoPath);

    const metadata = await this.getMetadata(videoPath);
    videoStore.set(id, { videoPath, metadata, sessionDir: dir });
    return { videoId: id, videoPath, metadata, sessionDir: dir };
  }

  async ingestFromBuffer(
    buffer: Buffer,
    ext: string = ".mp4"
  ): Promise<VideoProcessingResult> {
    const { id, dir } = await this.createSessionDir();
    const videoPath = path.join(dir, `source${ext}`);
    await fs.writeFile(videoPath, buffer);

    const metadata = await this.getMetadata(videoPath);
    videoStore.set(id, { videoPath, metadata, sessionDir: dir });
    return { videoId: id, videoPath, metadata, sessionDir: dir };
  }

  async getMetadata(videoPath: string): Promise<VideoMetadata> {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      videoPath,
    ]);

    const data = JSON.parse(stdout);
    const videoStream = data.streams?.find(
      (s: { codec_type: string }) => s.codec_type === "video"
    );
    const audioStream = data.streams?.find(
      (s: { codec_type: string }) => s.codec_type === "audio"
    );

    // Parse fps from "30/1" or "30000/1001" format — avoid eval()
    let fps = 0;
    if (videoStream?.r_frame_rate) {
      const parts = videoStream.r_frame_rate.split("/");
      if (parts.length === 2) {
        const num = parseFloat(parts[0]);
        const den = parseFloat(parts[1]);
        fps = den > 0 ? num / den : 0;
      } else {
        fps = parseFloat(parts[0]) || 0;
      }
    }

    return {
      duration: parseFloat(data.format?.duration || "0"),
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      fps: Math.round(fps * 100) / 100,
      codec: videoStream?.codec_name || "unknown",
      fileSize: parseInt(data.format?.size || "0"),
      format: data.format?.format_name || "unknown",
      hasAudio: !!audioStream,
    };
  }

  async extractFrames(
    videoPath: string,
    intervalSeconds: number = 3,
    maxFrames: number = 10
  ): Promise<ExtractedFrame[]> {
    const { dir } = await this.createSessionDir();

    await execFileAsync(
      "ffmpeg",
      [
        "-i",
        videoPath,
        "-vf",
        `fps=1/${intervalSeconds},scale=640:-1`,
        "-frames:v",
        String(maxFrames),
        "-q:v",
        "3",
        path.join(dir, "frame_%04d.jpg"),
      ],
      { timeout: 60000 }
    );

    const files = (await fs.readdir(dir))
      .filter((f) => f.startsWith("frame_"))
      .sort();

    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < files.length; i++) {
      const framePath = path.join(dir, files[i]);
      const data = await fs.readFile(framePath);
      frames.push({
        timestamp: i * intervalSeconds,
        base64: data.toString("base64"),
        isSceneChange: false,
      });
    }

    await fs.rm(dir, { recursive: true, force: true });
    return frames;
  }

  async extractSceneFrames(
    videoPath: string,
    threshold: number = 0.3,
    maxFrames: number = 12
  ): Promise<{ frames: ExtractedFrame[]; scenes: SceneSegment[] }> {
    const { dir } = await this.createSessionDir();

    // Extract frames at scene changes with timestamp metadata
    // ffmpeg outputs showinfo to stderr
    const { stderr } = await execFileAsync(
      "ffmpeg",
      [
        "-i",
        videoPath,
        "-vf",
        `select='gt(scene,${threshold})',showinfo,scale=640:-1`,
        "-vsync",
        "vfr",
        "-frames:v",
        String(maxFrames),
        "-q:v",
        "3",
        path.join(dir, "scene_%04d.jpg"),
      ],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
    );

    // Parse timestamps from showinfo output in stderr
    const timestamps: number[] = [];
    const showInfoPattern = /pts_time:(\d+\.?\d*)/g;
    let match;
    while ((match = showInfoPattern.exec(stderr)) !== null) {
      timestamps.push(parseFloat(match[1]));
    }

    const files = (await fs.readdir(dir))
      .filter((f) => f.startsWith("scene_"))
      .sort();

    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < files.length; i++) {
      const framePath = path.join(dir, files[i]);
      const data = await fs.readFile(framePath);
      frames.push({
        timestamp: timestamps[i] ?? i * 2,
        base64: data.toString("base64"),
        isSceneChange: true,
      });
    }

    // Build scene segments from timestamps
    const metadata = await this.getMetadata(videoPath);
    const allTimestamps = [
      ...new Set([0, ...timestamps, metadata.duration]),
    ].sort((a, b) => a - b);

    const scenes: SceneSegment[] = [];
    for (let i = 0; i < allTimestamps.length - 1; i++) {
      scenes.push({
        startTime: Math.round(allTimestamps[i] * 100) / 100,
        endTime: Math.round(allTimestamps[i + 1] * 100) / 100,
        duration:
          Math.round((allTimestamps[i + 1] - allTimestamps[i]) * 100) / 100,
      });
    }

    await fs.rm(dir, { recursive: true, force: true });
    return { frames, scenes };
  }

  async extractAudio(videoPath: string): Promise<string> {
    const { dir } = await this.createSessionDir();
    const audioPath = path.join(dir, "audio.wav");

    await execFileAsync(
      "ffmpeg",
      [
        "-i",
        videoPath,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        audioPath,
      ],
      { timeout: 120000 }
    );

    return audioPath;
  }

  async cleanup(sessionDir: string): Promise<void> {
    await fs.rm(sessionDir, { recursive: true, force: true });
  }
}
