import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MetaAdLibraryService } from "./services/meta-ad-library.js";
import { GoogleDriveService } from "./services/google-drive.js";
import { GoogleSlidesService } from "./services/google-slides.js";
import { createOAuth2Client } from "./services/google-auth.js";
import {
  VideoProcessingService,
  getStoredVideo,
} from "./services/video-processing.js";
import { TranscriptionService } from "./services/transcription.js";
import { conceptSessions } from "./services/concept-session.js";
import type {
  FacebookAd,
  AdCopy,
  AngleRecommendation,
  ConceptSlideData,
} from "./types.js";

// ── Initialize services ─────────────────────────────────────────────

function getMetaService(): MetaAdLibraryService {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN is not set");
  return new MetaAdLibraryService(token);
}

function getGoogleDriveService(): GoogleDriveService {
  return new GoogleDriveService(createOAuth2Client());
}

function getGoogleSlidesService(): GoogleSlidesService {
  return new GoogleSlidesService(createOAuth2Client());
}

function getVideoProcessingService(): VideoProcessingService {
  return new VideoProcessingService();
}

function getTranscriptionService(): TranscriptionService {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new TranscriptionService(apiKey);
}

// ── MCP Server ──────────────────────────────────────────────────────

const server = new McpServer({
  name: "facebook-ad-strategy-agent",
  version: "1.0.0",
});

// ── Tool 1: Search Reference Ads ────────────────────────────────────

server.tool(
  "search_reference_ads",
  `Search Meta's Ad Library for active Facebook/Instagram ads from specific brands or keywords.
Use this to find reference ads that can inspire creative concepts for a client.
Returns ad copy, headlines, descriptions, preview links, and platform info.`,
  {
    search_terms: z
      .string()
      .describe(
        "Keywords or brand name to search for (e.g. 'Glossier skincare', 'Athletic Greens')"
      ),
    countries: z
      .array(z.string())
      .default(["US"])
      .describe("ISO country codes where ads were shown (default: ['US'])"),
    media_type: z
      .enum(["ALL", "IMAGE", "VIDEO", "MEME", "NONE"])
      .default("ALL")
      .describe("Filter by media type"),
    active_only: z
      .boolean()
      .default(true)
      .describe("Only return currently active ads"),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Number of ads to return (max 50)"),
  },
  async ({ search_terms, countries, media_type, active_only, limit }) => {
    const meta = getMetaService();

    const result = await meta.searchAds({
      search_terms,
      ad_reached_countries: countries,
      media_type,
      ad_active_status: active_only ? "ACTIVE" : "ALL",
      limit,
    });

    if (result.ads.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No ads found for "${search_terms}" in ${countries.join(", ")}. Try broader search terms or different countries.`,
          },
        ],
      };
    }

    const formatted = result.ads.map((ad) => meta.formatAdForDisplay(ad));

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${result.ads.length} ads for "${search_terms}":\n\n${formatted.join("\n\n---\n\n")}`,
        },
      ],
    };
  }
);

// ── Tool 2: Recommend Angles ────────────────────────────────────────

server.tool(
  "recommend_angles",
  `Analyze a reference Facebook ad and recommend the top priority messaging angles for a new concept.
Provide the reference ad details and the client's messaging document content.
Returns ranked angle recommendations with rationale and suggested hooks.

IMPORTANT: This tool returns structured data for Claude to interpret. Claude should use its
creative strategy expertise to refine and present the recommendations conversationally.`,
  {
    reference_ad: z.object({
      page_name: z.string().describe("Brand/page name of the reference ad"),
      headline: z.string().optional().describe("Ad headline"),
      body_copy: z.string().optional().describe("Ad primary text / body copy"),
      description: z.string().optional().describe("Ad link description"),
      ad_url: z
        .string()
        .optional()
        .describe("URL to the ad preview/snapshot"),
    }),
    client_brand: z.string().describe("The client brand we're creating ads for"),
    client_product: z
      .string()
      .optional()
      .describe("Specific product or service being advertised"),
    messaging_angles: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
          hooks: z.array(z.string()).default([]),
        })
      )
      .describe(
        "Available messaging angles from the client's messaging document"
      ),
    target_audience: z
      .string()
      .optional()
      .describe("Target audience description"),
  },
  async ({
    reference_ad,
    client_brand,
    client_product,
    messaging_angles,
    target_audience,
  }) => {
    // Build analysis of the reference ad's approach
    const refAdSummary = [
      `Reference ad from: ${reference_ad.page_name}`,
      reference_ad.headline ? `Headline: "${reference_ad.headline}"` : null,
      reference_ad.body_copy
        ? `Body: "${reference_ad.body_copy.slice(0, 300)}${reference_ad.body_copy.length > 300 ? "..." : ""}"`
        : null,
      reference_ad.description
        ? `Description: "${reference_ad.description}"`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    // Analyze which angles align with the reference ad's approach
    const recommendations: AngleRecommendation[] = messaging_angles.map(
      (angle, index) => {
        // The MCP server provides structured data; Claude does the creative analysis
        return {
          angle_name: angle.name,
          relevance_score: 0, // Claude will assess this
          rationale: `Angle "${angle.name}" (${angle.description}) — evaluate against reference ad approach.`,
          suggested_hooks: angle.hooks.length > 0 ? angle.hooks : [],
          reference_ad_alignment: `Compare this angle to the reference ad's messaging strategy.`,
        };
      }
    );

    const analysisPrompt = `
## Reference Ad Analysis

${refAdSummary}

## Client Context
- Brand: ${client_brand}
${client_product ? `- Product: ${client_product}` : ""}
${target_audience ? `- Target Audience: ${target_audience}` : ""}

## Available Messaging Angles
${messaging_angles.map((a, i) => `${i + 1}. **${a.name}**: ${a.description}${a.hooks.length ? `\n   Hooks: ${a.hooks.join("; ")}` : ""}`).join("\n")}

## Instructions for Claude
Please analyze the reference ad's creative approach (hook type, emotional appeal, value proposition,
format/structure) and rank the available messaging angles by how well they could be adapted for
${client_brand}. For each recommended angle, explain:
1. Why this angle aligns with what's working in the reference ad
2. Which specific hooks would work best
3. How to adapt the reference ad's approach for ${client_brand}'s voice`;

    return {
      content: [
        {
          type: "text" as const,
          text: analysisPrompt,
        },
      ],
    };
  }
);

// ── Tool 3: Get Messaging Document ──────────────────────────────────

server.tool(
  "get_messaging_doc",
  `Retrieve a creative messaging document from Google Drive for a specific brand.
The messaging doc contains the brand's approved angles, hooks, value propositions, and tone of voice.
Can search by brand name or retrieve by direct file ID.`,
  {
    brand_name: z
      .string()
      .optional()
      .describe("Brand name to search for in Google Drive"),
    file_id: z
      .string()
      .optional()
      .describe("Direct Google Drive file ID if known"),
    folder_name: z
      .string()
      .optional()
      .describe("Optional folder name to scope the search"),
  },
  async ({ brand_name, file_id, folder_name }) => {
    const drive = getGoogleDriveService();

    // If we have a direct file ID, fetch it
    if (file_id) {
      const content = await drive.getDocumentContent(file_id);
      return {
        content: [
          {
            type: "text" as const,
            text: `## Messaging Document (File ID: ${file_id})\n\n${content}`,
          },
        ],
      };
    }

    // Otherwise search by brand name
    if (!brand_name) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Please provide either a brand_name to search for or a file_id to retrieve directly.",
          },
        ],
      };
    }

    const files = await drive.findMessagingDocument(brand_name, folder_name);

    if (files.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No messaging documents found for "${brand_name}"${folder_name ? ` in folder "${folder_name}"` : ""}. Try a different search term or provide the file ID directly.`,
          },
        ],
      };
    }

    // If multiple files found, list them for selection
    if (files.length > 1) {
      const fileList = files
        .map((f, i) => `${i + 1}. **${f.name}** (ID: ${f.id})`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${files.length} messaging documents for "${brand_name}":\n\n${fileList}\n\nCall this tool again with the specific file_id to retrieve the document content.`,
          },
        ],
      };
    }

    // Single file found — retrieve its content
    const content = await drive.getDocumentContent(files[0].id);
    return {
      content: [
        {
          type: "text" as const,
          text: `## Messaging Document: ${files[0].name}\n\n${content}`,
        },
      ],
    };
  }
);

// ── Tool 4: Write Ad Copy ───────────────────────────────────────────

server.tool(
  "write_ad_copy",
  `Generate Facebook ad copy variations based on a chosen messaging angle, reference ad, and brand guidelines.
Returns structured ad copy with headline, primary text, description, and CTA for each variation.

IMPORTANT: This tool provides structured context for Claude to write the actual copy.
Claude should use its copywriting expertise to craft compelling, on-brand ad copy.`,
  {
    brand: z.string().describe("Client brand name"),
    product: z.string().optional().describe("Specific product/service"),
    angle: z.object({
      name: z.string().describe("Messaging angle name"),
      description: z.string().describe("Angle description"),
      hooks: z
        .array(z.string())
        .default([])
        .describe("Available hooks for this angle"),
    }),
    reference_ad: z
      .object({
        page_name: z.string(),
        headline: z.string().optional(),
        body_copy: z.string().optional(),
        description: z.string().optional(),
      })
      .optional()
      .describe("Reference ad to draw inspiration from"),
    brand_voice: z
      .object({
        tone: z.string().describe("Brand tone (e.g. 'friendly and confident')"),
        style: z.string().describe("Writing style notes"),
        dos: z.array(z.string()).default([]).describe("Brand voice do's"),
        donts: z.array(z.string()).default([]).describe("Brand voice don'ts"),
      })
      .optional()
      .describe("Brand voice guidelines"),
    num_variations: z
      .number()
      .min(1)
      .max(10)
      .default(3)
      .describe("Number of copy variations to generate"),
    cta_options: z
      .array(z.string())
      .default(["Shop Now", "Learn More", "Get Started", "Sign Up"])
      .describe("Available CTA button options"),
    key_benefits: z
      .array(z.string())
      .default([])
      .describe("Key product/service benefits to highlight"),
  },
  async ({
    brand,
    product,
    angle,
    reference_ad,
    brand_voice,
    num_variations,
    cta_options,
    key_benefits,
  }) => {
    const brief = `
## Ad Copy Brief for ${brand}${product ? ` — ${product}` : ""}

### Messaging Angle
- **${angle.name}**: ${angle.description}
${angle.hooks.length ? `- Hooks: ${angle.hooks.join(" | ")}` : ""}

${
  reference_ad
    ? `### Reference Ad (${reference_ad.page_name})
${reference_ad.headline ? `- Headline: "${reference_ad.headline}"` : ""}
${reference_ad.body_copy ? `- Body: "${reference_ad.body_copy.slice(0, 500)}"` : ""}
${reference_ad.description ? `- Description: "${reference_ad.description}"` : ""}`
    : ""
}

${
  brand_voice
    ? `### Brand Voice
- Tone: ${brand_voice.tone}
- Style: ${brand_voice.style}
${brand_voice.dos.length ? `- Do: ${brand_voice.dos.join("; ")}` : ""}
${brand_voice.donts.length ? `- Don't: ${brand_voice.donts.join("; ")}` : ""}`
    : ""
}

${key_benefits.length ? `### Key Benefits\n${key_benefits.map((b) => `- ${b}`).join("\n")}` : ""}

### Requirements
- Generate **${num_variations} variations**
- Available CTAs: ${cta_options.join(", ")}
- Each variation needs: **Headline** (≤40 chars), **Primary Text** (≤125 chars for optimal, up to 500), **Description** (≤30 chars), **CTA**

### Instructions for Claude
Write ${num_variations} distinct ad copy variations for ${brand}. Each variation should:
1. Lead with a different hook from the angle
2. Be inspired by the reference ad's structure/approach but adapted for ${brand}'s voice
3. Include a clear value proposition tied to the angle
4. Use the brand voice guidelines
5. Format each variation as:
   - **Variation Name** (descriptive label like "Social Proof Hook" or "Problem-Solution")
   - **Headline**: ...
   - **Primary Text**: ...
   - **Description**: ...
   - **CTA**: ...`;

    return {
      content: [
        {
          type: "text" as const,
          text: brief,
        },
      ],
    };
  }
);

// ── Tool 5: Update Concept Slides ───────────────────────────────────

server.tool(
  "update_concept_slides",
  `Update a Google Slides presentation with a completed concept brief.
Can either populate a template slide (using placeholder replacement) or create a new slide from scratch.
Use this after finalizing the ad copy and creative direction.`,
  {
    presentation_id: z
      .string()
      .describe(
        "Google Slides presentation ID (from the URL: docs.google.com/presentation/d/{ID}/edit)"
      ),
    mode: z
      .enum(["template", "new_slide"])
      .default("new_slide")
      .describe(
        "'template' to fill placeholders in an existing slide, 'new_slide' to create a fresh concept slide"
      ),
    template_slide_id: z
      .string()
      .optional()
      .describe(
        "Object ID of the template slide to duplicate and populate (required for 'template' mode)"
      ),
    concept: z
      .object({
        concept_name: z.string().describe("Name for this concept (e.g. 'Social Proof V1')"),
        brand: z.string().describe("Client brand name"),
        angle: z.string().describe("Messaging angle used"),
        reference_ad_url: z
          .string()
          .optional()
          .describe("URL to the reference ad preview"),
        reference_ad_summary: z
          .string()
          .describe("Brief summary of the reference ad"),
        copy_variations: z
          .array(
            z.object({
              variation_name: z.string(),
              primary_text: z.string(),
              headline: z.string(),
              description: z.string(),
              cta: z.string(),
              angle: z.string(),
              hook_used: z.string(),
            })
          )
          .describe("Ad copy variations to include"),
        visual_direction: z
          .string()
          .describe("Visual/creative direction notes"),
        target_audience: z.string().describe("Target audience description"),
        key_messaging_points: z
          .array(z.string())
          .describe("Key messaging points to highlight"),
      })
      .describe("The concept data to populate the slide with"),
  },
  async ({ presentation_id, mode, template_slide_id, concept }) => {
    const slides = getGoogleSlidesService();

    let slideUrl: string;

    if (mode === "template") {
      if (!template_slide_id) {
        // List available slides so the user can pick a template
        const slideList = await slides.listSlides(presentation_id);
        const formatted = slideList
          .map((s) => `- Slide ${s.index + 1}: "${s.title}" (ID: ${s.objectId})`)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `No template_slide_id provided. Here are the slides in the presentation:\n\n${formatted}\n\nCall this tool again with the template_slide_id of the slide you want to use as a template.`,
            },
          ],
        };
      }

      slideUrl = await slides.updateConceptSlide(
        presentation_id,
        template_slide_id,
        concept as ConceptSlideData
      );
    } else {
      slideUrl = await slides.addConceptSlide(
        presentation_id,
        concept as ConceptSlideData
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Concept slide created successfully!\n\n**${concept.concept_name}** for ${concept.brand}\n- Angle: ${concept.angle}\n- Variations: ${concept.copy_variations.length}\n\nView slide: ${slideUrl}`,
        },
      ],
    };
  }
);

// ── Tool 6: List Presentation Slides (helper) ───────────────────────

server.tool(
  "list_slides",
  `List all slides in a Google Slides presentation. Useful for finding the right template slide
or seeing the current state of a concept deck before updating it.`,
  {
    presentation_id: z
      .string()
      .describe("Google Slides presentation ID"),
  },
  async ({ presentation_id }) => {
    const slides = getGoogleSlidesService();
    const slideList = await slides.listSlides(presentation_id);

    const formatted = slideList
      .map((s) => `${s.index + 1}. **${s.title}** (ID: \`${s.objectId}\`)`)
      .join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `## Slides in Presentation\n\n${formatted}\n\nUse the slide ID with the \`update_concept_slides\` tool to populate a template.`,
        },
      ],
    };
  }
);

// ── Tool 7: Ingest Video ─────────────────────────────────────────────

server.tool(
  "ingest_video",
  `Ingest a video for analysis from a URL, Google Drive file, or local file path.
Downloads/copies the video and extracts metadata (duration, resolution, codec, etc.).
Returns a video_id to use with analyze_video and other video tools.

Supports:
- Direct URLs (MP4, MOV, etc.)
- Google Drive file IDs or share links
- Local filesystem paths`,
  {
    source: z
      .enum(["url", "google_drive", "local"])
      .describe("Where to load the video from"),
    url: z
      .string()
      .optional()
      .describe("Video URL (required when source is 'url')"),
    file_id: z
      .string()
      .optional()
      .describe(
        "Google Drive file ID or share link (required when source is 'google_drive')"
      ),
    local_path: z
      .string()
      .optional()
      .describe(
        "Absolute path to local video file (required when source is 'local')"
      ),
  },
  async ({ source, url, file_id, local_path }) => {
    const video = getVideoProcessingService();

    try {
      let result;

      if (source === "url") {
        if (!url) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Please provide a `url` when source is 'url'.",
              },
            ],
          };
        }
        result = await video.ingestFromUrl(url);
      } else if (source === "google_drive") {
        if (!file_id) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Please provide a `file_id` when source is 'google_drive'.",
              },
            ],
          };
        }

        // Extract file ID from Google Drive share links
        let driveFileId = file_id;
        const driveUrlMatch = file_id.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (driveUrlMatch) {
          driveFileId = driveUrlMatch[1];
        }

        const drive = getGoogleDriveService();
        const { buffer, name } = await drive.downloadFile(driveFileId);
        const ext = name.match(/\.\w+$/)?.[0] || ".mp4";
        result = await video.ingestFromBuffer(buffer, ext);
      } else {
        if (!local_path) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Please provide a `local_path` when source is 'local'.",
              },
            ],
          };
        }
        result = await video.ingestFromLocal(local_path);
      }

      const m = result.metadata;
      const dur = `${Math.floor(m.duration / 60)}:${String(Math.floor(m.duration % 60)).padStart(2, "0")}`;

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Video ingested successfully.`,
              ``,
              `**Video ID:** \`${result.videoId}\``,
              `Use this ID with \`analyze_video\`, \`propose_video_concept\`, and other video tools.`,
              ``,
              `**Metadata:**`,
              `- Duration: ${dur} (${m.duration.toFixed(1)}s)`,
              `- Resolution: ${m.width}×${m.height}`,
              `- FPS: ${m.fps}`,
              `- Codec: ${m.codec}`,
              `- Format: ${m.format}`,
              `- File size: ${(m.fileSize / (1024 * 1024)).toFixed(1)} MB`,
              `- Audio track: ${m.hasAudio ? "Yes" : "No"}`,
            ].join("\n"),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ffprobe") || message.includes("ENOENT")) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Video ingestion failed: ffmpeg/ffprobe not found.\n\nInstall ffmpeg:\n- macOS: \`brew install ffmpeg\`\n- Ubuntu/Debian: \`sudo apt install ffmpeg\`\n- Windows: Download from ffmpeg.org/download.html`,
            },
          ],
        };
      }
      throw err;
    }
  }
);

// ── Tool 8: Analyze Video ────────────────────────────────────────────

server.tool(
  "analyze_video",
  `Perform a comprehensive analysis of an ingested video ad.
Extracts key frames at scene boundaries (returned as images for visual analysis),
detects scene structure and pacing, and optionally transcribes audio.

Returns interleaved images and text so Claude can:
1. See every key visual moment in the ad
2. Understand the scene-by-scene structure and timing
3. Read the transcript with timestamps
4. Perform a full creative teardown

Requires: Call ingest_video first to get a video_id.`,
  {
    video_id: z.string().describe("Video ID from ingest_video"),
    include_transcript: z
      .boolean()
      .default(true)
      .describe(
        "Extract and transcribe audio via OpenAI Whisper (requires OPENAI_API_KEY)"
      ),
    scene_threshold: z
      .number()
      .min(0.1)
      .max(0.9)
      .default(0.3)
      .describe(
        "Scene change sensitivity (lower = more scenes, default 0.3)"
      ),
    max_frames: z
      .number()
      .min(1)
      .max(20)
      .default(12)
      .describe("Maximum key frames to extract (default 12)"),
  },
  async ({ video_id, include_transcript, scene_threshold, max_frames }) => {
    const stored = getStoredVideo(video_id);
    if (!stored) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Video ID "${video_id}" not found. Call \`ingest_video\` first.`,
          },
        ],
      };
    }

    const video = getVideoProcessingService();
    const { videoPath, metadata } = stored;
    const content: (
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
    )[] = [];

    const dur = `${Math.floor(metadata.duration / 60)}:${String(Math.floor(metadata.duration % 60)).padStart(2, "0")}`;
    content.push({
      type: "text" as const,
      text: `## Video Analysis — \`${video_id}\`\nDuration: ${dur} | ${metadata.width}×${metadata.height} | ${metadata.fps} fps | ${metadata.codec}\n`,
    });

    // Try scene-change frame extraction first
    let sceneResult;
    try {
      sceneResult = await video.extractSceneFrames(
        videoPath,
        scene_threshold,
        max_frames
      );
    } catch {
      sceneResult = null;
    }

    if (sceneResult && sceneResult.frames.length > 0) {
      content.push({
        type: "text" as const,
        text: `### Scene Structure (${sceneResult.scenes.length} scenes detected)\n\nKey frames at scene boundaries:\n`,
      });

      for (let i = 0; i < sceneResult.frames.length; i++) {
        const frame = sceneResult.frames[i];
        const scene = sceneResult.scenes[i];
        const ts = frame.timestamp;
        const tsFmt = `${Math.floor(ts / 60)}:${String(Math.floor(ts % 60)).padStart(2, "0")}`;

        if (scene) {
          const endFmt = `${Math.floor(scene.endTime / 60)}:${String(Math.floor(scene.endTime % 60)).padStart(2, "0")}`;
          content.push({
            type: "text" as const,
            text: `**Scene ${i + 1}** — ${tsFmt} to ${endFmt} (${scene.duration.toFixed(1)}s)`,
          });
        } else {
          content.push({
            type: "text" as const,
            text: `**Frame at ${tsFmt}**`,
          });
        }

        content.push({
          type: "image" as const,
          data: frame.base64,
          mimeType: "image/jpeg",
        });
      }
    } else {
      // Fallback: regular interval frames
      const interval = Math.max(
        1,
        Math.ceil(metadata.duration / max_frames)
      );
      const intervalFrames = await video.extractFrames(
        videoPath,
        interval,
        max_frames
      );

      content.push({
        type: "text" as const,
        text: `### Key Frames (${intervalFrames.length} frames, every ${interval}s)\n`,
      });

      for (const frame of intervalFrames) {
        const tsFmt = `${Math.floor(frame.timestamp / 60)}:${String(Math.floor(frame.timestamp % 60)).padStart(2, "0")}`;
        content.push({
          type: "text" as const,
          text: `**${tsFmt}**`,
        });
        content.push({
          type: "image" as const,
          data: frame.base64,
          mimeType: "image/jpeg",
        });
      }
    }

    // Transcript
    if (include_transcript && metadata.hasAudio) {
      try {
        const audioPath = await video.extractAudio(videoPath);
        const transcription = getTranscriptionService();
        const result = await transcription.transcribe(audioPath);

        if (result.transcript) {
          const lines = result.segments.map((s) => {
            const st = `${Math.floor(s.startTime / 60)}:${String(Math.floor(s.startTime % 60)).padStart(2, "0")}`;
            const en = `${Math.floor(s.endTime / 60)}:${String(Math.floor(s.endTime % 60)).padStart(2, "0")}`;
            return `[${st}–${en}] ${s.text}`;
          });

          content.push({
            type: "text" as const,
            text: `\n### Transcript\n\n${lines.join("\n")}\n\n**Full transcript:** ${result.transcript}`,
          });
        } else {
          content.push({
            type: "text" as const,
            text: `\n### Transcript\nNo speech detected in the audio track.`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        content.push({
          type: "text" as const,
          text: `\n### Transcript\nTranscription unavailable: ${msg}\n\n_To enable: set the OPENAI_API_KEY environment variable._`,
        });
      }
    } else if (!metadata.hasAudio) {
      content.push({
        type: "text" as const,
        text: `\n### Transcript\nNo audio track detected in this video.`,
      });
    }

    // Structured video summary
    content.push({
      type: "text" as const,
      text: [
        ``,
        `### Video Summary`,
        ``,
        `Fill in the following structured fields based on the frames and transcript above:`,
        ``,
        `| Field | Value |`,
        `|-------|-------|`,
        `| **Title** | _Identify the ad title from text overlays, voiceover, or context_ |`,
        `| **Duration** | ${dur} (${metadata.duration.toFixed(1)}s) |`,
        `| **Caption Status** | _Are on-screen text captions/supers present? (Yes with burned-in / Yes with platform captions / No captions detected)_ |`,
        `| **Caption Text Samples** | _List the first 2-3 on-screen text overlays or caption lines verbatim_ |`,
        `| **B-Roll Detected** | _Is there B-roll footage? (Yes / No) — describe any supplemental footage vs. primary action_ |`,
        `| **Notes** | _Any notable production details: transitions, music style, aspect ratio choices, platform-specific formatting_ |`,
      ].join("\n"),
    });

    // Creative teardown prompt
    content.push({
      type: "text" as const,
      text: [
        ``,
        `### Creative Teardown Instructions`,
        ``,
        `Perform a full creative teardown of this video ad:`,
        ``,
        `1. **Hook Analysis** (first 3s): What grabs attention? Visual hook, text overlay, movement, audio?`,
        `2. **Visual Storytelling Arc**: How does the visual narrative progress?`,
        `3. **Scene Structure & Pacing**: Which scenes are longest/shortest? How does pacing drive engagement?`,
        `4. **Text Overlays & Graphics**: On-screen text, supers, graphic elements — when do they appear?`,
        `5. **Product Presentation**: When/how is the product shown? Lifestyle vs. product-focused vs. UGC?`,
        `6. **CTA Execution**: How does the ad close? What CTA is used and how?`,
        `7. **Target Audience Signals**: Who is this for? Visual/copy cues indicating target demo?`,
        `8. **Emotional Triggers**: Fear, aspiration, social proof, urgency?`,
        `9. **Format & Style**: UGC, studio, motion graphics, testimonial, problem-solution?`,
        `10. **What's Working**: What makes this effective? What creative choices could be adapted?`,
      ].join("\n"),
    });

    return { content };
  }
);

// ── Tool 9: Propose Video Concept ────────────────────────────────────

server.tool(
  "propose_video_concept",
  `Start an iterative concept refinement session based on a video ad analysis.
Claude proposes creative concepts, receives feedback, and refines until approved.

Call after analyze_video. Pass Claude's creative teardown as video_analysis_summary
so the session stores full context for iterative refinement.

Returns a session_id and structured brief for Claude to generate the first concept proposal.`,
  {
    video_id: z.string().describe("Video ID from ingest_video"),
    brand: z.string().describe("Client brand name"),
    product: z.string().optional().describe("Specific product/service"),
    target_audience: z
      .string()
      .optional()
      .describe("Target audience description"),
    messaging_angles: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
          hooks: z.array(z.string()).default([]),
        })
      )
      .default([])
      .describe("Available messaging angles from the client's messaging doc"),
    video_analysis_summary: z
      .string()
      .describe(
        "Claude's creative teardown from analyze_video (paste the full analysis)"
      ),
    creative_direction: z
      .string()
      .optional()
      .describe("Specific creative direction or constraints from the client"),
  },
  async ({
    video_id,
    brand,
    product,
    target_audience,
    messaging_angles,
    video_analysis_summary,
    creative_direction,
  }) => {
    const session = conceptSessions.create({
      videoId: video_id,
      brand,
      product,
      targetAudience: target_audience,
      videoAnalysisSummary: video_analysis_summary,
    });

    const anglesSection =
      messaging_angles.length > 0
        ? messaging_angles
            .map(
              (a, i) =>
                `${i + 1}. **${a.name}**: ${a.description}${a.hooks.length ? `\n   Hooks: ${a.hooks.join(" | ")}` : ""}`
            )
            .join("\n")
        : "No pre-defined angles — propose angles based on the video analysis.";

    const brief = [
      `## Concept Proposal Brief`,
      ``,
      `**Session ID:** \`${session.id}\``,
      `Use this ID with \`refine_concept\` to iterate.`,
      ``,
      `### Client Context`,
      `- Brand: ${brand}`,
      product ? `- Product: ${product}` : null,
      target_audience ? `- Target Audience: ${target_audience}` : null,
      creative_direction
        ? `- Creative Direction: ${creative_direction}`
        : null,
      ``,
      `### Video Analysis Summary`,
      video_analysis_summary,
      ``,
      `### Available Messaging Angles`,
      anglesSection,
      ``,
      `### Instructions for Claude`,
      ``,
      `Based on the video analysis, propose a creative concept for ${brand} that adapts what's working in the reference video:`,
      ``,
      `1. **Concept Name** — Descriptive label (e.g. "UGC Transformation Story")`,
      `2. **Recommended Angle** — Which messaging angle to lead with and why`,
      `3. **Video Structure** — Scene-by-scene breakdown:`,
      `   - Duration per scene`,
      `   - Visual description`,
      `   - On-screen text / supers`,
      `   - Voiceover / audio`,
      `4. **Hook Strategy** — How the first 3 seconds grab attention`,
      `5. **CTA Approach** — How the ad closes and drives action`,
      `6. **Ad Copy** — Headline, primary text, description, CTA button`,
      `7. **Visual Direction** — Style, mood, color palette, talent/no talent`,
      `8. **Why This Works** — How this leverages what's effective in the reference`,
      ``,
      `Present enough detail for a creative team to produce it.`,
      `After presenting, ask for feedback to refine.`,
    ]
      .filter((line) => line !== null)
      .join("\n");

    return {
      content: [{ type: "text" as const, text: brief }],
    };
  }
);

// ── Tool 10: Refine Concept ──────────────────────────────────────────

server.tool(
  "refine_concept",
  `Iterate on a previously proposed video ad concept based on feedback.
Records the current concept and feedback, then returns full iteration context
for Claude to produce an informed refinement.

Agentic loop:
1. Claude proposes concept (via propose_video_concept)
2. User gives feedback
3. Claude calls refine_concept with its proposal + the feedback
4. Claude produces refined concept
5. Repeat 2-4 until approved`,
  {
    session_id: z
      .string()
      .describe("Concept session ID from propose_video_concept"),
    previous_concept: z
      .string()
      .describe("The concept Claude proposed in the previous iteration"),
    feedback: z
      .string()
      .describe("User feedback — what to change, keep, or improve"),
  },
  async ({ session_id, previous_concept, feedback }) => {
    const session = conceptSessions.get(session_id);
    if (!session) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Session "${session_id}" not found. Start a new session with \`propose_video_concept\`.`,
          },
        ],
      };
    }

    conceptSessions.addIteration(session_id, previous_concept, feedback);

    const historyLines = session.iterations.map((iter) =>
      [
        `#### Iteration ${iter.iterationNumber}`,
        `**Proposed concept:**`,
        iter.concept,
        iter.feedback ? `\n**Feedback:** ${iter.feedback}` : "",
        `---`,
      ].join("\n")
    );

    const brief = [
      `## Concept Refinement — Iteration ${session.iterations.length + 1}`,
      ``,
      `**Session:** \`${session.id}\``,
      `**Brand:** ${session.brand}${session.product ? ` — ${session.product}` : ""}`,
      session.targetAudience
        ? `**Target Audience:** ${session.targetAudience}`
        : null,
      ``,
      `### Video Analysis Context`,
      session.videoAnalysisSummary,
      ``,
      `### Iteration History`,
      ``,
      ...historyLines,
      ``,
      `### Latest Feedback`,
      `> ${feedback}`,
      ``,
      `### Instructions for Claude`,
      ``,
      `Refine the concept based on the feedback:`,
      `1. Address every point in the feedback`,
      `2. Preserve elements that were working (not mentioned in feedback)`,
      `3. Clearly indicate what changed from the previous iteration`,
      `4. Present the refined concept in the same structure`,
      `5. Ask if further refinement is needed or if the concept is approved`,
      ``,
      `If approved, suggest next steps: \`write_ad_copy\` or \`update_concept_slides\`.`,
    ]
      .filter((line) => line !== null)
      .join("\n");

    return {
      content: [{ type: "text" as const, text: brief }],
    };
  }
);

// ── Tool 11: Get Concept History ─────────────────────────────────────

server.tool(
  "get_concept_history",
  `Retrieve the full iteration history for a concept refinement session.
Shows all proposals and feedback across iterations. Useful for reviewing
concept evolution or resuming a refinement session.`,
  {
    session_id: z
      .string()
      .optional()
      .describe(
        "Session ID to retrieve. Omit to list all active sessions."
      ),
  },
  async ({ session_id }) => {
    if (!session_id) {
      const sessions = conceptSessions.listSessions();
      if (sessions.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No concept sessions found. Start one with `propose_video_concept`.",
            },
          ],
        };
      }

      const listing = sessions.map(
        (s) =>
          `- **${s.brand}**${s.product ? ` — ${s.product}` : ""} (ID: \`${s.id}\`) — ${s.iterations.length} iteration(s), started ${s.createdAt.toISOString()}`
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `## Active Concept Sessions\n\n${listing.join("\n")}\n\nCall with a specific \`session_id\` to see full history.`,
          },
        ],
      };
    }

    const session = conceptSessions.get(session_id);
    if (!session) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Session "${session_id}" not found.`,
          },
        ],
      };
    }

    const historyLines =
      session.iterations.length === 0
        ? [
            "No iterations yet — call `propose_video_concept` to generate the first proposal.",
          ]
        : session.iterations.map((iter) =>
            [
              `### Iteration ${iter.iterationNumber} (${iter.timestamp.toISOString()})`,
              ``,
              `**Concept:**`,
              iter.concept,
              iter.feedback ? `\n**Feedback:** ${iter.feedback}` : "",
            ].join("\n")
          );

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `## Concept History — ${session.brand}${session.product ? ` — ${session.product}` : ""}`,
            `**Session ID:** \`${session.id}\``,
            `**Video ID:** \`${session.videoId}\``,
            `**Iterations:** ${session.iterations.length}`,
            `**Started:** ${session.createdAt.toISOString()}`,
            ``,
            `### Video Analysis`,
            session.videoAnalysisSummary,
            ``,
            ...historyLines,
          ].join("\n"),
        },
      ],
    };
  }
);

// ── Start server ────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Facebook Ad Strategy Agent MCP server running on stdio");
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
