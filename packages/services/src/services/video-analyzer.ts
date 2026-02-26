import OpenAI from "openai";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import type {
  VideoMetadata,
  ExtractedFrame,
  FrameAnalysis,
  VideoAnalysisResult,
  CreativeStrategyRow,
  BatchAnalysisResult,
} from "../types.js";

const execFileAsync = promisify(execFile);
function getFFmpegPath() {
  return process.env.FFMPEG_PATH || "ffmpeg";
}
const TEMP_DIR = "/tmp/video-analysis";

const FRAME_ANALYSIS_PROMPT = `You are a creative strategist analyzing frames from video advertisements for a performance marketing agency.

For each frame provided, analyze and return structured JSON data. Your response must be a JSON object with a "frames" array.

For each frame, identify:
1. **sceneType**: One of: "hook" (attention-grabbing opening), "body" (main content/argument), "cta" (call to action), "b-roll" (supplementary footage), "transition" (between scenes), "testimonial" (person speaking about experience), "product_shot" (product display/demo)
2. **onScreenText**: Array of any text overlays, captions, or text visible on screen. Extract verbatim.
3. **people**: Describe people visible (count, gender, approximate age, what they're doing)
4. **products**: Array of any products, packaging, or branded items visible
5. **setting**: Describe the environment (home, studio, kitchen, outdoors, etc.)
6. **visualStyle**: Note the visual approach (UGC selfie, professional studio, split-screen, before/after, text-heavy graphic, podcast style, etc.)
7. **description**: One sentence describing what is happening in this frame

Ad type context:
- UGC: Person talking to camera, casual setting, phone-shot quality
- VSL: Text-heavy, professional voiceover, stock footage or B-roll heavy, often podcast aesthetic
- PDP: Product-focused, showing features/benefits visually
- Social Media: Polished but casual, lifestyle-focused

Respond ONLY with valid JSON:
{
  "frames": [
    {
      "timestampSeconds": number,
      "sceneType": "hook"|"body"|"cta"|"b-roll"|"transition"|"testimonial"|"product_shot",
      "onScreenText": ["string"],
      "people": "string",
      "products": ["string"],
      "setting": "string",
      "visualStyle": "string",
      "description": "string"
    }
  ]
}`;

const CREATIVE_SYNTHESIS_PROMPT = `You are a senior creative strategist at a performance marketing agency specializing in Facebook/Instagram video ads. You analyze video ad assets and produce structured creative strategy data.

You will receive analyses of multiple video ads including visual frame-by-frame breakdowns and audio transcripts. Synthesize this into creative strategy rows.

Each row represents a distinct ANGLE — a creative positioning approach identified across the videos. Group related videos under the same angle.

For each angle, produce ALL 15 fields:

1. **namingConvention**: Unique code (e.g., "AK-01", "AK-02")
2. **priority**: 1-3 (1 = highest potential based on hook clarity, emotional trigger strength, format alignment)
3. **persona**: Target demographic from visual/verbal cues (e.g., "Women 30-50+")
4. **angle**: Main creative positioning in 3-6 words
5. **subAngles**: Specific variations within this angle
6. **primaryBenefits**: Product benefits, separated by " · "
7. **description**: 3-5 sentence narrative of the angle's premise and what makes it compelling
8. **emotionalFear**: Core emotion/fear driving this angle. Write from the target's perspective. 2-4 visceral sentences.
9. **problemSolutionPromise**: Three-part framework — PROBLEM: (2-4 sentences), SOLUTION: (2-4 sentences), PROMISE: (2-4 sentences)
10. **beforeAfterFrameworks**: 3-4 BEFORE/AFTER pairs showing the transformation
11. **exampleHeadline**: 8-10 scroll-stopping headlines, numbered
12. **exampleTestimonial**: Complete testimonial script (150-200 words), first person, conversational UGC tone
13. **exampleUGCHook**: 5 short video hooks (Hook 1: through Hook 5:), each 2-3 sentences for the first 3 seconds of a video ad
14. **keyPointsFraming**: 5-7 strategic messaging pillars explaining WHY each framing device works
15. **objections**: 3-4 Q&A pairs addressing anticipated objections

RULES:
- Base analysis on what you ACTUALLY SEE and HEAR in the videos
- Group related videos by creative approach, not file name
- Raw clips show individual shots from a larger concept — infer from folder structure and clip names
- Match tone to ad style: UGC gets conversational copy, VSLs get educational/dramatic copy
- Priority 1 angles should have the clearest hook-to-CTA pipeline

Respond with valid JSON:
{
  "rows": [
    {
      "namingConvention": "string",
      "priority": number,
      "persona": "string",
      "angle": "string",
      "subAngles": "string",
      "primaryBenefits": "string",
      "description": "string",
      "emotionalFear": "string",
      "problemSolutionPromise": "string",
      "beforeAfterFrameworks": "string",
      "exampleHeadline": "string",
      "exampleTestimonial": "string",
      "exampleUGCHook": "string",
      "keyPointsFraming": "string",
      "objections": "string"
    }
  ]
}`;

export interface BatchOptions {
  concurrency?: number;
  resumeFrom?: string;
  brandContext?: string;
  frameDetail?: "low" | "high";
}

export class VideoAnalyzerService {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async getVideoMetadata(filePath: string): Promise<VideoMetadata> {
    // ffmpeg -i always exits with error since no output specified, so we catch it
    const { stderr } = await execFileAsync(getFFmpegPath(), ["-i", filePath], {
      timeout: 30000,
    }).catch((err) => ({ stderr: (err as any).stderr as string, stdout: "" }));

    const durationMatch = stderr.match(
      /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/
    );
    const videoMatch = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
    const codecMatch = stderr.match(/Video:\s*(\w+)/);

    const hours = parseInt(durationMatch?.[1] || "0");
    const mins = parseInt(durationMatch?.[2] || "0");
    const secs = parseInt(durationMatch?.[3] || "0");
    const durationSeconds = hours * 3600 + mins * 60 + secs;

    const stat = await fs.promises.stat(filePath);

    return {
      filePath,
      fileName: path.basename(filePath),
      durationSeconds,
      width: parseInt(videoMatch?.[1] || "0"),
      height: parseInt(videoMatch?.[2] || "0"),
      codec: codecMatch?.[1] || "unknown",
      fileSize: stat.size,
      videoType: this.classifyVideoType(filePath),
      folderContext: this.extractFolderContext(filePath),
    };
  }

  async extractFrames(metadata: VideoMetadata): Promise<ExtractedFrame[]> {
    const outputDir = path.join(
      TEMP_DIR,
      `frames_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    );
    await fs.promises.mkdir(outputDir, { recursive: true });

    const maxFrames = metadata.videoType === "finished_ad" ? 20 : 10;

    // Calculate timestamps to extract
    let timestamps: number[] = [];

    // Try scene detection for finished ads
    if (metadata.videoType === "finished_ad" && metadata.durationSeconds > 10) {
      timestamps = await this.detectSceneChanges(
        metadata.filePath,
        metadata.durationSeconds
      );
    }

    // Fallback to uniform sampling
    if (timestamps.length < 3) {
      timestamps = [];
      const interval = Math.max(2, metadata.durationSeconds / maxFrames);
      for (let t = 0; t < metadata.durationSeconds; t += interval) {
        timestamps.push(Math.round(t * 10) / 10);
      }
    }

    // Always include first and last frame
    if (timestamps[0] !== 0) timestamps.unshift(0);
    const lastTs = Math.max(0, metadata.durationSeconds - 0.5);
    if (
      timestamps.length === 0 ||
      timestamps[timestamps.length - 1] < lastTs - 1
    ) {
      timestamps.push(lastTs);
    }

    // Cap to maxFrames by even selection
    if (timestamps.length > maxFrames) {
      const step = timestamps.length / maxFrames;
      const sampled = [timestamps[0]];
      for (let i = 1; i < maxFrames - 1; i++) {
        sampled.push(timestamps[Math.floor(i * step)]);
      }
      sampled.push(timestamps[timestamps.length - 1]);
      timestamps = sampled;
    }

    // Extract frames at timestamps
    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const outPath = path.join(
        outputDir,
        `frame_${i.toString().padStart(3, "0")}.jpg`
      );

      try {
        await execFileAsync(
          getFFmpegPath(),
          [
            "-ss",
            ts.toString(),
            "-i",
            metadata.filePath,
            "-frames:v",
            "1",
            "-q:v",
            "2",
            "-y",
            outPath,
          ],
          { timeout: 15000 }
        );

        const imgBuffer = await fs.promises.readFile(outPath);
        frames.push({
          framePath: outPath,
          timestampSeconds: ts,
          base64Data: imgBuffer.toString("base64"),
        });
      } catch {
        // Skip frames that fail to extract
      }
    }

    return frames;
  }

  async analyzeFrames(
    frames: ExtractedFrame[],
    metadata: VideoMetadata
  ): Promise<FrameAnalysis[]> {
    if (frames.length === 0) return [];

    const imageContent: OpenAI.ChatCompletionContentPart[] = [];
    for (const frame of frames) {
      imageContent.push({
        type: "text",
        text: `--- Frame at ${frame.timestampSeconds.toFixed(1)}s ---`,
      });
      imageContent.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${frame.base64Data}`,
          detail: "low",
        },
      });
    }

    const response = await this.retryWithBackoff(() =>
      this.openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 4000,
        messages: [
          { role: "system", content: FRAME_ANALYSIS_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze these ${frames.length} frames from a ${metadata.videoType === "finished_ad" ? "finished video ad" : "raw video clip"} (${metadata.durationSeconds}s total). File: ${metadata.fileName}. Folder: ${metadata.folderContext}.`,
              },
              ...imageContent,
            ],
          },
        ],
        response_format: { type: "json_object" },
      })
    );

    try {
      const parsed = JSON.parse(
        response.choices[0].message.content || '{"frames":[]}'
      );
      return (parsed.frames || []) as FrameAnalysis[];
    } catch {
      return [];
    }
  }

  async transcribeAudio(filePath: string): Promise<string> {
    const tempAudioPath = path.join(TEMP_DIR, `audio_${Date.now()}.mp3`);
    await fs.promises.mkdir(TEMP_DIR, { recursive: true });

    try {
      await execFileAsync(
        getFFmpegPath(),
        [
          "-i",
          filePath,
          "-vn",
          "-acodec",
          "libmp3lame",
          "-ab",
          "64k",
          "-ar",
          "16000",
          "-y",
          tempAudioPath,
        ],
        { timeout: 120000 }
      );

      const stat = await fs.promises.stat(tempAudioPath);
      if (stat.size < 1000) {
        // Audio too small, likely silent
        return "(no audio)";
      }

      const transcription = await this.retryWithBackoff(() =>
        this.openai.audio.transcriptions.create({
          file: fs.createReadStream(tempAudioPath),
          model: "whisper-1",
          response_format: "text",
        })
      );

      return typeof transcription === "string"
        ? transcription
        : (transcription as any).text || "";
    } catch (err) {
      return `(transcription failed: ${(err as Error).message})`;
    } finally {
      await fs.promises.unlink(tempAudioPath).catch(() => {});
    }
  }

  async analyzeVideo(filePath: string): Promise<VideoAnalysisResult> {
    // 1. Get metadata
    const metadata = await this.getVideoMetadata(filePath);

    // 2. Extract frames
    const frames = await this.extractFrames(metadata);

    // 3. Run Vision + Whisper in parallel
    const [frameAnalyses, transcript] = await Promise.all([
      this.analyzeFrames(frames, metadata),
      this.transcribeAudio(filePath),
    ]);

    // 4. Compute narrative structure
    const narrativeStructure = this.computeNarrativeStructure(
      frameAnalyses,
      metadata.durationSeconds
    );

    // 5. Cleanup frames
    await this.cleanupFrames(frames);

    return {
      metadata,
      frameAnalyses,
      transcript,
      narrativeStructure,
    };
  }

  async synthesizeCreativeStrategy(
    analyses: VideoAnalysisResult[],
    brandContext?: string
  ): Promise<CreativeStrategyRow[]> {
    // Chunk analyses into groups to stay under TPM limits
    const CHUNK_SIZE = 20;
    const chunks: VideoAnalysisResult[][] = [];
    for (let i = 0; i < analyses.length; i += CHUNK_SIZE) {
      chunks.push(analyses.slice(i, i + CHUNK_SIZE));
    }

    const allRows: CreativeStrategyRow[] = [];

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      console.log(
        `Synthesizing chunk ${ci + 1}/${chunks.length} (${chunk.length} videos)...`
      );

      const videoSummaries = chunk
        .map((a, i) => {
          const timeline = a.frameAnalyses
            .slice(0, 8)
            .map(
              (f) =>
                `${f.timestampSeconds.toFixed(0)}s: [${f.sceneType}] ${f.description}${f.onScreenText.length > 0 ? ' | Text: "' + f.onScreenText.join('", "') + '"' : ""}`
            )
            .join("\n    ");

          return `VIDEO ${ci * CHUNK_SIZE + i + 1}: ${a.metadata.fileName} (${a.metadata.videoType}, ${a.metadata.durationSeconds}s)
  Folder: ${a.metadata.folderContext}
  Transcript: "${a.transcript.slice(0, 300)}${a.transcript.length > 300 ? "..." : ""}"
  Visual Timeline:
    ${timeline}
  Scene Breakdown: ${JSON.stringify(a.narrativeStructure.sceneBreakdown)}`;
        })
        .join("\n\n---\n\n");

      const response = await this.retryWithBackoff(() =>
        this.openai.chat.completions.create({
          model: "gpt-4o",
          max_tokens: 8000,
          messages: [
            { role: "system", content: CREATIVE_SYNTHESIS_PROMPT },
            {
              role: "user",
              content: `${brandContext ? `Brand Context:\n${brandContext}\n\n` : ""}Analyze the following ${chunk.length} videos (batch ${ci + 1} of ${chunks.length}) and produce creative strategy rows:\n\n${videoSummaries}`,
            },
          ],
          response_format: { type: "json_object" },
        })
      );

      try {
        const parsed = JSON.parse(
          response.choices[0].message.content || '{"rows":[]}'
        );
        const rows = (parsed.rows || []) as CreativeStrategyRow[];
        allRows.push(...rows);
      } catch {
        // Skip chunk on parse failure
      }

      // Rate limit pause between chunks
      if (ci < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    return allRows;
  }

  async analyzeBatch(
    folderPath: string,
    options: BatchOptions = {}
  ): Promise<BatchAnalysisResult> {
    const startTime = Date.now();
    await fs.promises.mkdir(TEMP_DIR, { recursive: true });

    // 1. Discover videos
    const videoFiles = await this.discoverVideos(folderPath);

    // 2. Load existing results if resuming
    let completedAnalyses: VideoAnalysisResult[] = [];
    const processedPaths = new Set<string>();
    const intermediatePath = path.join(
      TEMP_DIR,
      `batch_${path.basename(folderPath).replace(/\s+/g, "_")}.json`
    );

    if (options.resumeFrom) {
      try {
        const existing = JSON.parse(
          await fs.promises.readFile(options.resumeFrom, "utf-8")
        );
        completedAnalyses = existing.videoAnalyses || [];
        for (const a of completedAnalyses) {
          processedPaths.add(a.metadata.filePath);
        }
      } catch {
        // Start fresh if resume file can't be read
      }
    }

    // 3. Process remaining videos
    const remaining = videoFiles.filter((f) => !processedPaths.has(f));
    let errorCount = 0;
    let totalFrames = completedAnalyses.reduce(
      (sum, a) => sum + a.frameAnalyses.length,
      0
    );

    for (let i = 0; i < remaining.length; i++) {
      try {
        console.error(
          `[${i + 1}/${remaining.length}] Analyzing: ${path.basename(remaining[i])}`
        );
        const analysis = await this.analyzeVideo(remaining[i]);
        completedAnalyses.push(analysis);
        totalFrames += analysis.frameAnalyses.length;

        // Save intermediate results
        await fs.promises.writeFile(
          intermediatePath,
          JSON.stringify({ videoAnalyses: completedAnalyses }, null, 2)
        );

        // Rate limit delay
        if (i < remaining.length - 1) {
          await new Promise((r) => setTimeout(r, 5000));
        }
      } catch (err) {
        errorCount++;
        console.error(
          `Error analyzing ${remaining[i]}: ${(err as Error).message}`
        );
      }
    }

    // 4. Synthesize creative strategy
    const creativeStrategy = await this.synthesizeCreativeStrategy(
      completedAnalyses,
      options.brandContext
    );

    const result: BatchAnalysisResult = {
      videoAnalyses: completedAnalyses,
      creativeStrategy,
      stats: {
        totalVideos: videoFiles.length,
        successCount: completedAnalyses.length,
        errorCount,
        totalFramesAnalyzed: totalFrames,
        estimatedCost: this.estimateCost(totalFrames, completedAnalyses.length),
        processingTimeMs: Date.now() - startTime,
      },
    };

    // Save final results
    await fs.promises.writeFile(
      intermediatePath,
      JSON.stringify(result, null, 2)
    );

    return result;
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private classifyVideoType(filePath: string): "finished_ad" | "raw_clip" {
    const lower = filePath.toLowerCase();
    const fileName = path.basename(filePath).toLowerCase();

    // Finished ads
    if (lower.includes("blind vsl") || lower.includes("social media content"))
      return "finished_ad";
    if (lower.includes("ugc content") || lower.includes("billo"))
      return "finished_ad";
    if (/^#\d+.*v\d+.*\.mp4$/.test(fileName)) return "finished_ad";
    if (/^vsl-ad\d+\.mp4$/.test(fileName)) return "finished_ad";
    if (/^akka_sm_\d+\.mp4$/.test(fileName)) return "finished_ad";

    // Raw clips
    if (/^[sb]\d/i.test(fileName)) return "raw_clip";
    if (/^(hook|cta|broll|b-roll|take|discovery)/i.test(fileName))
      return "raw_clip";
    if (/\b(take\s*\d)/i.test(fileName)) return "raw_clip";

    return "finished_ad";
  }

  private extractFolderContext(filePath: string): string {
    // Try to extract relative path from known roots
    for (const root of ["/brand-assets/", "/Downloads/"]) {
      const idx = filePath.indexOf(root);
      if (idx !== -1) {
        return path.dirname(filePath.slice(idx + root.length));
      }
    }
    return path.dirname(filePath);
  }

  private async detectSceneChanges(
    filePath: string,
    _duration: number
  ): Promise<number[]> {
    try {
      const { stderr } = await execFileAsync(
        getFFmpegPath(),
        [
          "-i",
          filePath,
          "-vf",
          "select='gt(scene,0.3)',showinfo",
          "-vsync",
          "vfr",
          "-f",
          "null",
          "-",
        ],
        { timeout: 60000 }
      ).catch((err) => ({
        stderr: (err as any).stderr as string,
        stdout: "",
      }));

      const matches = [...stderr.matchAll(/pts_time:([\d.]+)/g)];
      return matches.map((m) => parseFloat(m[1]));
    } catch {
      return [];
    }
  }

  private computeNarrativeStructure(
    frames: FrameAnalysis[],
    _duration: number
  ): VideoAnalysisResult["narrativeStructure"] {
    const breakdown: Record<string, number> = {};
    let hookTs: number | null = null;
    let bodyTs: number | null = null;
    let ctaTs: number | null = null;

    for (const f of frames) {
      breakdown[f.sceneType] = (breakdown[f.sceneType] || 0) + 1;
      if (f.sceneType === "hook" && hookTs === null)
        hookTs = f.timestampSeconds;
      if (f.sceneType === "body" && bodyTs === null)
        bodyTs = f.timestampSeconds;
      if (f.sceneType === "cta" && ctaTs === null) ctaTs = f.timestampSeconds;
    }

    return {
      hookTimestamp: hookTs,
      bodyTimestamp: bodyTs,
      ctaTimestamp: ctaTs,
      totalScenes: frames.length,
      sceneBreakdown: breakdown,
    };
  }

  private async discoverVideos(folderPath: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.promises.readdir(folderPath, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const full = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.discoverVideos(full)));
      } else if (/\.(mp4|mov)$/i.test(entry.name)) {
        results.push(full);
      }
    }
    return results.sort();
  }

  private estimateCost(totalFrames: number, totalVideos: number): number {
    const visionCost = totalFrames * 0.0002;
    const whisperCost = totalVideos * 2 * 0.006;
    const textCost = totalVideos * 0.01 + 0.05;
    return Math.round((visionCost + whisperCost + textCost) * 100) / 100;
  }

  private async cleanupFrames(frames: ExtractedFrame[]): Promise<void> {
    for (const frame of frames) {
      await fs.promises.unlink(frame.framePath).catch(() => {});
    }
    if (frames.length > 0) {
      const dir = path.dirname(frames[0].framePath);
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 5000
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        if (attempt === maxRetries) throw err;
        const isRateLimit =
          err?.status === 429 || err?.message?.includes("rate");
        if (!isRateLimit && attempt > 0) throw err;
        const delay = baseDelay * Math.pow(2, attempt);
        console.error(
          `Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${err.message}`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error("Unreachable");
  }
}
