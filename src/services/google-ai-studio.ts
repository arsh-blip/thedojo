import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Types ────────────────────────────────────────────────────────────

export interface GeneratedImage {
  base64: string;
  mimeType: string;
  text?: string;
}

export interface GeneratedVideo {
  filePath: string;
  durationSeconds: number;
}

export type ImageAspectRatio =
  | "1:1"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "9:16"
  | "16:9";

export type ImageSize = "1K" | "2K" | "4K";

export type VideoAspectRatio = "16:9" | "9:16";
export type VideoResolution = "720p" | "1080p" | "4k";
export type VideoDuration = "4" | "6" | "8";

export interface ImageGenerationOptions {
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  imageSize?: ImageSize;
  referenceImages?: { base64: string; mimeType: string }[];
}

export interface VideoGenerationOptions {
  prompt: string;
  model?: "standard" | "fast";
  aspectRatio?: VideoAspectRatio;
  resolution?: VideoResolution;
  durationSeconds?: VideoDuration;
  negativePrompt?: string;
  referenceImage?: { base64: string; mimeType: string };
}

// ── Service ──────────────────────────────────────────────────────────

export class GoogleAIStudioService {
  private ai: GoogleGenAI;
  private outputDir: string;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.outputDir = path.join(os.tmpdir(), "fb-ad-gen");
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  // ── Image Generation (Nano Banana Pro) ─────────────────────────────

  async generateImage(options: ImageGenerationOptions): Promise<GeneratedImage> {
    const {
      prompt,
      aspectRatio = "1:1",
      imageSize = "2K",
      referenceImages,
    } = options;

    // Build contents: text prompt + optional reference images
    const contents: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [{ text: prompt }];

    if (referenceImages?.length) {
      for (const ref of referenceImages) {
        contents.push({
          inlineData: { mimeType: ref.mimeType, data: ref.base64 },
        });
      }
    }

    const response = await this.ai.models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio,
          imageSize,
        },
      },
    });

    const result: GeneratedImage = { base64: "", mimeType: "image/png" };

    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts?.length) {
      throw new Error("No content returned from Nano Banana Pro");
    }

    for (const part of parts) {
      if ("text" in part && part.text) {
        result.text = part.text;
      } else if ("inlineData" in part && part.inlineData) {
        result.base64 = part.inlineData.data!;
        result.mimeType = part.inlineData.mimeType || "image/png";
      }
    }

    if (!result.base64) {
      throw new Error(
        "Nano Banana Pro returned text but no image. The prompt may have been blocked by safety filters."
      );
    }

    return result;
  }

  // ── Video Generation (Veo 3.1) ────────────────────────────────────

  async generateVideo(options: VideoGenerationOptions): Promise<GeneratedVideo> {
    const {
      prompt,
      model = "standard",
      aspectRatio = "9:16",
      resolution = "1080p",
      durationSeconds = "8",
      negativePrompt,
      referenceImage,
    } = options;

    const modelId =
      model === "fast"
        ? "veo-3.1-fast-generate-preview"
        : "veo-3.1-generate-preview";

    // Build request config
    const config: Record<string, unknown> = {
      aspectRatio,
      resolution,
      durationSeconds,
      numberOfVideos: 1,
      personGeneration: "allow_all",
    };

    if (negativePrompt) {
      config.negativePrompt = negativePrompt;
    }

    // Build request
    const request: Record<string, unknown> = {
      model: modelId,
      prompt,
      config,
    };

    if (referenceImage) {
      request.image = {
        imageBytes: referenceImage.base64,
        mimeType: referenceImage.mimeType,
      };
    }

    // Start generation (long-running operation)
    let operation = await this.ai.models.generateVideos(request as any);

    // Poll until done (max ~6 minutes)
    const startTime = Date.now();
    const timeoutMs = 360_000;
    const pollIntervalMs = 10_000;

    while (!operation.done) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(
          "Video generation timed out after 6 minutes. Try the 'fast' model or a simpler prompt."
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      operation = await this.ai.operations.getVideosOperation({
        operation,
      });
    }

    const generatedVideos = (operation as any).response?.generatedVideos;
    if (!generatedVideos?.length) {
      throw new Error(
        "Video generation completed but no videos were returned. The prompt may have been blocked."
      );
    }

    // Download to temp file
    const filename = `ad_video_${Date.now()}.mp4`;
    const outputPath = path.join(this.outputDir, filename);

    await this.ai.files.download({
      file: generatedVideos[0].video!,
      downloadPath: outputPath,
    });

    // Parse actual duration from config
    const dur = parseInt(durationSeconds, 10) || 8;

    return {
      filePath: outputPath,
      durationSeconds: dur,
    };
  }
}
