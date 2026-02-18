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
import { brandStore } from "./services/brand-store.js";
import {
  renderCreativeGuidelines,
  renderTeardownGuidelines,
} from "./services/creative-guidelines.js";
import {
  processBatch,
  type VideoSource,
  type BatchItemResult,
} from "./services/video-queue.js";
import type {
  FacebookAd,
  AdCopy,
  AngleRecommendation,
  ConceptSlideData,
  CreativeStrategyPillar,
  StrategyMission,
} from "./types.js";

// Shared content block type used by analysis helpers and batch processing
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

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
3. How to adapt the reference ad's approach for ${client_brand}'s voice
4. Which Schwartz Awareness Ladder stage the reference ad targets and how the angle should match

${renderCreativeGuidelines()}`;

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

${renderCreativeGuidelines()}

### Instructions for Claude
Write ${num_variations} distinct ad copy variations for ${brand}. Each variation should:
1. Open with a **shock-provoking, scroll-stopping hook** — exaggerated, bold, pattern-interrupting
2. Be inspired by the reference ad's structure/approach but adapted for ${brand}'s voice
3. Include a clear value proposition tied to the angle
4. Use the brand voice guidelines
5. Keep the tone proactive and direct — no hedging, no passive voice
6. Apply the reference frameworks above (Schwartz Awareness Ladder, Hopkins specificity, StoryBrand, etc.)
7. Format each variation as:
   - **Variation Name** (descriptive label like "Shock Hook" or "Exaggerated Problem-Solution")
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

Requires: Call ingest_video first to get a video_id.
Pass brand_slug to auto-load the brand's strategy, reviews, and top ads for cross-referencing.`,
  {
    video_id: z.string().describe("Video ID from ingest_video"),
    brand_slug: z
      .string()
      .optional()
      .describe("Brand slug — auto-loads strategy pillars, reviews, and top ads for cross-referencing"),
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
  async ({ video_id, brand_slug, include_transcript, scene_threshold, max_frames }) => {
    // Load brand context from store if brand_slug provided
    let brandContext: AnalysisBrandContext | undefined;
    if (brand_slug) {
      const ctx = await brandStore.getFullContext(brand_slug);
      if (ctx) {
        const anglesFromPillars = (ctx.strategy?.pillars || []).map((p) => ({
          name: p.angle,
          description: p.description || "",
          hooks: [...(p.example_ugc_hooks || [p.example_ugc_hook]), ...(p.example_headlines || [p.example_headline])].filter(Boolean) as string[],
        }));

        brandContext = {
          brand: ctx.profile.name,
          product: ctx.strategy?.product || ctx.profile.product,
          targetAudience: ctx.profile.target_audience,
          angles: anglesFromPillars,
          strategyPillars: ctx.strategy?.pillars,
          strategyProduct: ctx.strategy?.product,
          strategyMission: ctx.strategy?.mission,
          reviews: ctx.reviews.map((r) => ({
            source: r.source,
            text: r.text,
            themes: r.themes,
          })),
          topAds: ctx.top_ads.map((a) => ({
            brand_source: a.brand_source,
            headline: a.headline,
            body_copy: a.body_copy,
            format: a.format,
            why_it_works: a.why_it_works,
          })),
        };
      }
    }

    const content = await analyzeVideoCore(video_id, {
      includeTranscript: include_transcript,
      sceneThreshold: scene_threshold,
      maxFrames: max_frames,
      brandContext,
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
      `Based on the video analysis, propose a creative concept for ${brand} that adapts what's working in the reference video.`,
      ``,
      renderCreativeGuidelines(),
      ``,
      `Deliver the concept in this structure:`,
      ``,
      `1. **Concept Name** — Descriptive label (e.g. "Shock & Transform UGC")`,
      `2. **Recommended Angle** — Which messaging angle to lead with and why`,
      `3. **Video Structure** — Scene-by-scene breakdown:`,
      `   - Duration per scene`,
      `   - Visual description`,
      `   - On-screen text / supers (bold, scroll-stopping)`,
      `   - Voiceover / audio`,
      `4. **Hook Strategy** — How the first 3 seconds STOP the scroll. Must be shocking, provocative, or pattern-interrupting.`,
      `5. **CTA Approach** — How the ad closes and drives action. Direct and urgent.`,
      `6. **Ad Copy** — Headline, primary text, description, CTA button. All copy should be proactive and exaggerated.`,
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

// ── Tool 12: Setup Brand ──────────────────────────────────────────────

server.tool(
  "setup_brand",
  `Create or update a brand profile. Creates a folder for the brand to store
its creative strategy, reviews, and top-performing ads.
Returns the brand slug used to reference this brand in other tools.`,
  {
    name: z.string().describe("Brand name (e.g. 'Glossier', 'Summer Fridays')"),
    product: z.string().optional().describe("Primary product or service"),
    target_audience: z.string().optional().describe("Target audience description"),
    brand_voice: z
      .object({
        tone: z.string().describe("Brand tone"),
        style: z.string().describe("Writing style"),
        dos: z.array(z.string()).default([]),
        donts: z.array(z.string()).default([]),
      })
      .optional()
      .describe("Brand voice guidelines"),
  },
  async ({ name, product, target_audience, brand_voice }) => {
    const profile = await brandStore.createBrand({
      name,
      product,
      targetAudience: target_audience,
      brandVoice: brand_voice,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Brand profile created.`,
            ``,
            `**Brand:** ${profile.name}`,
            `**Slug:** \`${profile.slug}\` — use this in other tools`,
            product ? `**Product:** ${product}` : null,
            target_audience ? `**Target Audience:** ${target_audience}` : null,
            ``,
            `**Folder:** \`brands/${profile.slug}/\``,
            `- \`profile.json\` — brand metadata`,
            `- \`strategy.json\` — import with \`import_brand_strategy\``,
            `- \`reviews.json\` — add with \`add_brand_reviews\``,
            `- \`top-ads.json\` — save with \`save_top_ad\``,
            ``,
            `Next: Import the brand's creative strategy JSON with \`import_brand_strategy\`.`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  }
);

// ── Tool 13: Import Brand Strategy ───────────────────────────────────

const strategyPillarSchema = z.object({
  naming_convention: z.string().default(""),
  priority: z.string().default(""),
  persona: z.string().default(""),
  angle: z.string(),
  sub_angles: z.array(z.string()).default([]),
  sub_angle: z.string().optional(),
  primary_benefits: z.array(z.string()).default([]),
  description: z.string().default(""),
  emotional_fear: z.string().default(""),
  problem_solution_promise: z.union([
    z.string(),
    z.object({ problem: z.string(), solution: z.string(), promise: z.string() }),
  ]).default(""),
  before_after: z.union([
    z.string(),
    z.object({ before: z.string(), after: z.string() }),
  ]).default(""),
  frameworks: z.array(z.string()).default([]),
  example_headline: z.string().default(""),
  example_headlines: z.array(z.string()).optional(),
  example_testimonial: z.string().default(""),
  example_ugc_hook: z.string().default(""),
  example_ugc_hooks: z.array(z.string()).optional(),
  key_points_framing: z.array(z.string()).default([]),
  objections: z.array(z.string()).default([]),
  audience_persona: z.object({
    type: z.string(),
    awareness_level: z.string(),
    priority: z.number(),
    traits: z.array(z.string()).default([]),
  }).optional(),
  output_instructions: z.object({
    emotional_drivers: z.array(z.string()),
    headline_archetypes: z.array(z.string()),
    meta_cognition_steps: z.array(z.string()),
    format: z.string(),
  }).optional(),
  creative_inspiration: z.object({
    reference_headlines: z.array(z.string()),
    reference_testimonial: z.string(),
    reference_ugc_hooks: z.array(z.string()),
  }).optional(),
  successful_formats: z.array(z.string()).optional(),
  deliverable: z.string().optional(),
});

/**
 * Auto-detect and transform rich keyed strategy JSON.
 * Handles the format where top-level keys are pillar names (e.g., "RP-01: The Tractor Cab")
 * and each value contains brand_context, audience_persona, mission, etc.
 */
function transformRichStrategyJson(
  parsed: Record<string, unknown>
): { pillars: CreativeStrategyPillar[]; product?: string; mission?: StrategyMission } {
  const pillars: CreativeStrategyPillar[] = [];
  let product: string | undefined;
  let mission: StrategyMission | undefined;

  for (const [key, value] of Object.entries(parsed)) {
    const entry = value as Record<string, unknown>;
    const bc = (entry.brand_context || {}) as Record<string, unknown>;
    const ap = (entry.audience_persona || {}) as Record<string, unknown>;
    const oi = (entry.output_instructions || {}) as Record<string, unknown>;
    const ci = (entry.creative_inspiration || {}) as Record<string, unknown>;
    const ms = (entry.mission || {}) as Record<string, unknown>;

    // Extract shared product (same across all pillars)
    if (!product && bc.product) {
      product = bc.product as string;
    }

    // Extract shared mission (same across all pillars)
    if (!mission && ms.goal) {
      mission = {
        goal: (ms.goal as string) || "",
        requirements: (ms.requirements as string[]) || [],
        negative_requirements: (ms.negative_requirements as string[]) || [],
      };
    }

    // Parse primary_benefits from comma/dot-separated string to array
    let primaryBenefits: string[] = [];
    if (typeof bc.primary_benefits === "string") {
      primaryBenefits = (bc.primary_benefits as string)
        .split(/[·,]/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(bc.primary_benefits)) {
      primaryBenefits = bc.primary_benefits as string[];
    }

    const pillar: CreativeStrategyPillar = {
      naming_convention: key,
      priority: String(ap.priority ?? ""),
      persona: (ap.type as string) || "",
      angle: (bc.angle as string) || key,
      sub_angles: bc.sub_angle ? [bc.sub_angle as string] : [],
      sub_angle: (bc.sub_angle as string) || undefined,
      primary_benefits: primaryBenefits,
      description: (bc.emotional_fear as string) || "",
      emotional_fear: (bc.emotional_fear as string) || "",
      problem_solution_promise: bc.problem_solution_promise && typeof bc.problem_solution_promise === "object"
        ? bc.problem_solution_promise as { problem: string; solution: string; promise: string }
        : String(bc.problem_solution_promise || ""),
      before_after: bc.before_after_framework && typeof bc.before_after_framework === "object"
        ? bc.before_after_framework as { before: string; after: string }
        : String(bc.before_after_framework || ""),
      frameworks: (entry.references as string[]) || [],
      example_headline: Array.isArray(bc.example_headlines) ? (bc.example_headlines as string[])[0] || "" : "",
      example_headlines: Array.isArray(bc.example_headlines) ? bc.example_headlines as string[] : undefined,
      example_testimonial: (bc.example_testimonial as string) || "",
      example_ugc_hook: Array.isArray(bc.example_ugc_hooks) ? (bc.example_ugc_hooks as string[])[0] || "" : "",
      example_ugc_hooks: Array.isArray(bc.example_ugc_hooks) ? bc.example_ugc_hooks as string[] : undefined,
      key_points_framing: Array.isArray(bc.key_points) ? bc.key_points as string[] : [],
      objections: Array.isArray(bc.objections) ? bc.objections as string[] : [],
      audience_persona: ap.type ? {
        type: (ap.type as string) || "",
        awareness_level: (ap.awareness_level as string) || "",
        priority: Number(ap.priority) || 0,
        traits: (ap.traits as string[]) || [],
      } : undefined,
      output_instructions: oi.emotional_drivers ? {
        emotional_drivers: (oi.emotional_drivers as string[]) || [],
        headline_archetypes: (oi.headline_archetypes as string[]) || [],
        meta_cognition_steps: (oi.meta_cognition_steps as string[]) || [],
        format: (oi.format as string) || "",
      } : undefined,
      creative_inspiration: ci.reference_headlines ? {
        reference_headlines: (ci.reference_headlines as string[]) || [],
        reference_testimonial: (ci.reference_testimonial as string) || "",
        reference_ugc_hooks: (ci.reference_ugc_hooks as string[]) || [],
      } : undefined,
      successful_formats: Array.isArray(bc.successful_formats) ? bc.successful_formats as string[] : undefined,
      deliverable: (entry.deliverable as string) || undefined,
    };

    pillars.push(pillar);
  }

  return { pillars, product, mission };
}

/** Detect if an object is a rich keyed strategy (keys are pillar names with brand_context inside) */
function isRichStrategyJson(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const entries = Object.values(obj as Record<string, unknown>);
  if (entries.length === 0) return false;
  // Check if the first entry has brand_context — signature of the rich format
  const first = entries[0];
  return !!first && typeof first === "object" && "brand_context" in (first as Record<string, unknown>);
}

server.tool(
  "import_brand_strategy",
  `Import a brand's creative strategy pillars from JSON.

Supports THREE formats:
1. **Simple array** — array of pillar objects with standard columns
2. **Wrapped object** — { pillars: [...] } or { product: "...", pillars: [...] }
3. **Rich keyed format** — object where each key is a pillar name (e.g., "RP-01: The Tractor Cab")
   containing brand_context, audience_persona, mission, output_instructions, creative_inspiration.
   Automatically extracts product and mission requirements from this format.

You can paste the JSON directly or provide a path to a local JSON file.
The strategy is saved to the brand's folder and used to cross-reference
video analysis and ad copy generation.`,
  {
    brand_slug: z.string().describe("Brand slug from setup_brand"),
    pillars: z
      .array(strategyPillarSchema)
      .optional()
      .describe("Array of strategy pillars (the JSON data)"),
    json_file_path: z
      .string()
      .optional()
      .describe("Path to a local JSON file containing the pillars array"),
    strategy_json: z
      .string()
      .optional()
      .describe("Raw JSON string — supports all three formats including the rich keyed format"),
  },
  async ({ brand_slug, pillars, json_file_path, strategy_json }) => {
    const profile = await brandStore.findBrand(brand_slug);
    if (!profile) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Brand "${brand_slug}" not found. Run \`setup_brand\` first.`,
          },
        ],
      };
    }

    let data: CreativeStrategyPillar[];
    let productName: string | undefined;
    let missionData: StrategyMission | undefined;

    if (pillars && pillars.length > 0) {
      data = pillars as CreativeStrategyPillar[];
    } else {
      // Get raw JSON from file or string
      let rawJson: string | undefined;
      if (json_file_path) {
        try {
          rawJson = await import("fs/promises").then((f) =>
            f.readFile(json_file_path, "utf-8")
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [
              { type: "text" as const, text: `Failed to read JSON file: ${msg}` },
            ],
          };
        }
      } else if (strategy_json) {
        rawJson = strategy_json;
      }

      if (!rawJson) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Provide `pillars` (array), `json_file_path`, or `strategy_json` (raw JSON string).",
            },
          ],
        };
      }

      try {
        const parsed = JSON.parse(rawJson);

        if (isRichStrategyJson(parsed)) {
          // Rich keyed format — auto-transform
          const result = transformRichStrategyJson(parsed);
          data = result.pillars;
          productName = result.product;
          missionData = result.mission;
        } else if (Array.isArray(parsed)) {
          data = parsed;
        } else {
          // Wrapped object: { pillars: [...], product?: "..." }
          data = parsed.pillars || [];
          productName = parsed.product;
          if (parsed.mission) {
            missionData = parsed.mission as StrategyMission;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Failed to parse JSON: ${msg}` },
          ],
        };
      }
    }

    if (data.length === 0) {
      return {
        content: [
          { type: "text" as const, text: "No pillars found in the provided data." },
        ],
      };
    }

    const strategy = await brandStore.importStrategy(profile.slug, data, {
      product: productName,
      mission: missionData,
    });

    const summary = data
      .map(
        (p, i) =>
          `${i + 1}. **${p.angle}** (P${p.priority || "—"}) — ${p.persona || "General"}` +
          (p.sub_angle ? `\n   Sub-angle: ${p.sub_angle}` : "") +
          (p.sub_angles?.length ? `\n   Sub-angles: ${p.sub_angles.join(", ")}` : "") +
          (p.audience_persona ? `\n   Audience: ${p.audience_persona.type} (${p.audience_persona.awareness_level})` : "")
      )
      .join("\n");

    const extras: string[] = [];
    if (productName) extras.push(`**Product:** ${productName}`);
    if (missionData) extras.push(`**Mission:** ${missionData.goal.slice(0, 100)}...`);

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Strategy imported for **${profile.name}** — ${data.length} pillars.`,
            extras.length ? extras.join("\n") : null,
            ``,
            `### Pillars`,
            summary,
            ``,
            `Saved to \`brands/${profile.slug}/strategy.json\`.`,
            `These pillars will be used to cross-reference video analysis and ad copy generation when you pass \`brand_slug: "${profile.slug}"\`.`,
          ].filter(Boolean).join("\n"),
        },
      ],
    };
  }
);

// ── Tool 14: Add Brand Reviews ───────────────────────────────────────

server.tool(
  "add_brand_reviews",
  `Add customer reviews to a brand's stored context.
Reviews help inform messaging angles, identify real customer language,
and ground ad copy in authentic testimonials.`,
  {
    brand_slug: z.string().describe("Brand slug"),
    reviews: z
      .array(
        z.object({
          source: z.string().describe("Review source (e.g. 'Amazon', 'TrustPilot', 'Instagram DM')"),
          text: z.string().describe("Review text"),
          rating: z.number().optional().describe("Star rating if available"),
          date: z.string().optional().describe("Review date"),
          themes: z
            .array(z.string())
            .default([])
            .describe("Key themes (e.g. 'fast results', 'easy to use')"),
        })
      )
      .min(1)
      .describe("Reviews to add"),
  },
  async ({ brand_slug, reviews }) => {
    const profile = await brandStore.findBrand(brand_slug);
    if (!profile) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Brand "${brand_slug}" not found. Run \`setup_brand\` first.`,
          },
        ],
      };
    }

    const added = await brandStore.addReviews(profile.slug, reviews);
    const allReviews = await brandStore.getReviews(profile.slug);

    return {
      content: [
        {
          type: "text" as const,
          text: `Added ${added.length} reviews to **${profile.name}** (${allReviews.length} total).\n\nThese will be available when analyzing videos or generating ad copy with \`brand_slug: "${profile.slug}"\`.`,
        },
      ],
    };
  }
);

// ── Tool 15: Save Top-Performing Ad ──────────────────────────────────

server.tool(
  "save_top_ad",
  `Save a top-performing ad as a reference for a brand.
Top ads serve as benchmarks — their hooks, structures, and copy patterns
are used to inform future creative and cross-reference analysis.`,
  {
    brand_slug: z.string().describe("Brand slug to save the ad under"),
    brand_source: z.string().describe("Brand that ran this ad (e.g. 'Competitor X')"),
    headline: z.string().optional(),
    body_copy: z.string().optional(),
    description: z.string().optional(),
    ad_url: z.string().optional().describe("URL to the ad or preview"),
    platform: z.string().optional().describe("e.g. 'Facebook', 'Instagram', 'TikTok'"),
    format: z.string().optional().describe("e.g. 'UGC Video', 'Static Image', 'Carousel'"),
    why_it_works: z.string().optional().describe("Notes on what makes this ad effective"),
    metrics_notes: z.string().optional().describe("Performance notes if available"),
    video_id: z.string().optional().describe("Video ID from ingest_video if this ad was analyzed"),
  },
  async (params) => {
    const profile = await brandStore.findBrand(params.brand_slug);
    if (!profile) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Brand "${params.brand_slug}" not found. Run \`setup_brand\` first.`,
          },
        ],
      };
    }

    const { brand_slug, ...adData } = params;
    const saved = await brandStore.saveTopAd(profile.slug, adData);
    const allAds = await brandStore.getTopAds(profile.slug);

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Top ad saved to **${profile.name}** (${allAds.length} total).`,
            ``,
            `**ID:** \`${saved.id}\``,
            `**Source:** ${saved.brand_source}`,
            saved.headline ? `**Headline:** ${saved.headline}` : null,
            saved.format ? `**Format:** ${saved.format}` : null,
            saved.why_it_works
              ? `**Why it works:** ${saved.why_it_works}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  }
);

// ── Tool 16: Get Brand Context ───────────────────────────────────────

server.tool(
  "get_brand_context",
  `Retrieve the full stored context for a brand — profile, creative strategy
pillars, reviews, and top-performing ads. Use this before analysis or
copy generation to ground the output in the brand's specific strategy.

Pass no brand_slug to list all available brands.`,
  {
    brand_slug: z
      .string()
      .optional()
      .describe("Brand slug. Omit to list all brands."),
  },
  async ({ brand_slug }) => {
    if (!brand_slug) {
      const brands = await brandStore.listBrands();
      if (brands.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No brands set up yet. Use `setup_brand` to create one.",
            },
          ],
        };
      }

      const listing = brands.map(
        (b) =>
          `- **${b.name}** (\`${b.slug}\`)${b.product ? ` — ${b.product}` : ""}`
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `## Available Brands\n\n${listing.join("\n")}\n\nCall with a \`brand_slug\` to see full context.`,
          },
        ],
      };
    }

    const ctx = await brandStore.getFullContext(brand_slug);
    if (!ctx) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Brand "${brand_slug}" not found.`,
          },
        ],
      };
    }

    const sections: string[] = [];

    // Profile
    sections.push(
      `## ${ctx.profile.name}`,
      `**Slug:** \`${ctx.profile.slug}\``,
      ctx.profile.product ? `**Product:** ${ctx.profile.product}` : "",
      ctx.profile.target_audience
        ? `**Target Audience:** ${ctx.profile.target_audience}`
        : ""
    );

    if (ctx.profile.brand_voice) {
      const bv = ctx.profile.brand_voice;
      sections.push(
        `\n### Brand Voice`,
        `- Tone: ${bv.tone}`,
        `- Style: ${bv.style}`,
        bv.dos.length ? `- Do: ${bv.dos.join("; ")}` : "",
        bv.donts.length ? `- Don't: ${bv.donts.join("; ")}` : ""
      );
    }

    // Strategy
    if (ctx.strategy && ctx.strategy.pillars.length > 0) {
      const strat = ctx.strategy;
      sections.push(`\n### Creative Strategy (${strat.pillars.length} pillars)`);
      if (strat.product) sections.push(`**Product:** ${strat.product}`);
      if (strat.mission) {
        sections.push(
          `**Mission:** ${strat.mission.goal}`,
          strat.mission.requirements.length ? `**Requirements:** ${strat.mission.requirements.join(" | ")}` : "",
          strat.mission.negative_requirements.length ? `**Negative Requirements:** ${strat.mission.negative_requirements.join(" | ")}` : ""
        );
      }
      for (const p of strat.pillars) {
        // Format PSP — handle both string and object
        let pspText: string;
        if (typeof p.problem_solution_promise === "object") {
          const psp = p.problem_solution_promise;
          pspText = `Problem: ${psp.problem.slice(0, 150)}... → Solution: ${psp.solution.slice(0, 150)}... → Promise: ${psp.promise.slice(0, 150)}...`;
        } else {
          pspText = p.problem_solution_promise || "—";
        }

        // Format Before/After
        let baText: string;
        if (typeof p.before_after === "object") {
          baText = `Before: ${p.before_after.before || "—"} → After: ${p.before_after.after || "—"}`;
        } else {
          baText = p.before_after || "—";
        }

        sections.push(
          `\n#### ${p.naming_convention || p.angle} (P${p.priority || "—"})`,
          `- **Angle:** ${p.angle}`,
          p.sub_angle ? `- **Sub-Angle:** ${p.sub_angle}` : "",
          `- **Persona:** ${p.persona || "—"}`,
          p.audience_persona ? `- **Audience:** ${p.audience_persona.type} (${p.audience_persona.awareness_level})` : "",
          p.primary_benefits.length
            ? `- **Benefits:** ${p.primary_benefits.join(", ")}`
            : "",
          `- **Emotional Fear:** ${p.emotional_fear || "—"}`,
          `- **P>S>P:** ${pspText}`,
          `- **Before/After:** ${baText}`,
          `- **Example Headline:** ${(p.example_headlines || [p.example_headline]).filter(Boolean)[0] || "—"}`,
          `- **Example UGC Hook:** ${(p.example_ugc_hooks || [p.example_ugc_hook]).filter(Boolean)[0] || "—"}`,
          p.key_points_framing.length
            ? `- **Key Points:** ${p.key_points_framing.join("; ")}`
            : "",
          p.objections.length ? `- **Objections:** ${p.objections.join("; ")}` : ""
        );
      }
    } else {
      sections.push(
        `\n### Creative Strategy`,
        `_Not imported yet. Use \`import_brand_strategy\`._`
      );
    }

    // Reviews
    sections.push(
      `\n### Reviews (${ctx.reviews.length})${ctx.reviews.length === 0 ? "\n_None yet. Use `add_brand_reviews`._" : ""}`
    );
    for (const r of ctx.reviews.slice(0, 10)) {
      sections.push(
        `- ${r.rating ? `${"★".repeat(r.rating)} ` : ""}(${r.source}) "${r.text.slice(0, 120)}${r.text.length > 120 ? "..." : ""}"`
      );
    }
    if (ctx.reviews.length > 10) {
      sections.push(`_...and ${ctx.reviews.length - 10} more._`);
    }

    // Top ads
    sections.push(
      `\n### Top-Performing Ads (${ctx.top_ads.length})${ctx.top_ads.length === 0 ? "\n_None yet. Use `save_top_ad`._" : ""}`
    );
    for (const a of ctx.top_ads.slice(0, 10)) {
      sections.push(
        `- **${a.brand_source}**${a.format ? ` (${a.format})` : ""}${a.headline ? ` — "${a.headline}"` : ""}${a.why_it_works ? `\n  _${a.why_it_works}_` : ""}`
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: sections.filter(Boolean).join("\n"),
        },
      ],
    };
  }
);

// ── Batch helpers (shared by batch_analyze_videos) ───────────────────

async function ingestVideoFromSource(
  source: VideoSource
): Promise<{ videoId: string }> {
  const video = getVideoProcessingService();

  if (source.type === "url") {
    const r = await video.ingestFromUrl(source.url);
    return { videoId: r.videoId };
  } else if (source.type === "google_drive") {
    let driveFileId = source.file_id;
    const m = source.file_id.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) driveFileId = m[1];
    const drive = getGoogleDriveService();
    const { buffer, name } = await drive.downloadFile(driveFileId);
    const ext = name.match(/\.\w+$/)?.[0] || ".mp4";
    const r = await video.ingestFromBuffer(buffer, ext);
    return { videoId: r.videoId };
  } else {
    const r = await video.ingestFromLocal(source.local_path);
    return { videoId: r.videoId };
  }
}

interface AnalysisBrandContext {
  brand: string;
  product?: string;
  targetAudience?: string;
  angles: { name: string; description: string; hooks: string[] }[];
  strategyPillars?: CreativeStrategyPillar[];
  strategyProduct?: string;
  strategyMission?: StrategyMission;
  reviews?: { source: string; text: string; themes?: string[] }[];
  topAds?: {
    brand_source: string;
    headline?: string;
    body_copy?: string;
    format?: string;
    why_it_works?: string;
  }[];
}

async function analyzeVideoCore(
  videoId: string,
  opts: {
    includeTranscript: boolean;
    sceneThreshold: number;
    maxFrames: number;
    brandContext?: AnalysisBrandContext;
  }
): Promise<ContentBlock[]> {
  const stored = getStoredVideo(videoId);
  if (!stored) {
    return [
      { type: "text", text: `Video ID "${videoId}" not found.` },
    ];
  }

  const video = getVideoProcessingService();
  const { videoPath, metadata } = stored;
  const content: ContentBlock[] = [];

  const dur = `${Math.floor(metadata.duration / 60)}:${String(Math.floor(metadata.duration % 60)).padStart(2, "0")}`;
  content.push({
    type: "text",
    text: `## Video Analysis — \`${videoId}\`\nDuration: ${dur} | ${metadata.width}×${metadata.height} | ${metadata.fps} fps | ${metadata.codec}\n`,
  });

  // Scene-change frame extraction
  let sceneResult;
  try {
    sceneResult = await video.extractSceneFrames(
      videoPath,
      opts.sceneThreshold,
      opts.maxFrames
    );
  } catch {
    sceneResult = null;
  }

  if (sceneResult && sceneResult.frames.length > 0) {
    content.push({
      type: "text",
      text: `### Scene Structure (${sceneResult.scenes.length} scenes detected)\n\nKey frames at scene boundaries:\n`,
    });
    for (let i = 0; i < sceneResult.frames.length; i++) {
      const frame = sceneResult.frames[i];
      const scene = sceneResult.scenes[i];
      const ts = frame.timestamp;
      const tsFmt = `${Math.floor(ts / 60)}:${String(Math.floor(ts % 60)).padStart(2, "0")}`;
      if (scene) {
        const endFmt = `${Math.floor(scene.endTime / 60)}:${String(Math.floor(scene.endTime % 60)).padStart(2, "0")}`;
        content.push({ type: "text", text: `**Scene ${i + 1}** — ${tsFmt} to ${endFmt} (${scene.duration.toFixed(1)}s)` });
      } else {
        content.push({ type: "text", text: `**Frame at ${tsFmt}**` });
      }
      content.push({ type: "image", data: frame.base64, mimeType: "image/jpeg" });
    }
  } else {
    const interval = Math.max(1, Math.ceil(metadata.duration / opts.maxFrames));
    const intervalFrames = await video.extractFrames(videoPath, interval, opts.maxFrames);
    content.push({ type: "text", text: `### Key Frames (${intervalFrames.length} frames, every ${interval}s)\n` });
    for (const frame of intervalFrames) {
      const tsFmt = `${Math.floor(frame.timestamp / 60)}:${String(Math.floor(frame.timestamp % 60)).padStart(2, "0")}`;
      content.push({ type: "text", text: `**${tsFmt}**` });
      content.push({ type: "image", data: frame.base64, mimeType: "image/jpeg" });
    }
  }

  // Transcript
  if (opts.includeTranscript && metadata.hasAudio) {
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
        content.push({ type: "text", text: `\n### Transcript\n\n${lines.join("\n")}\n\n**Full transcript:** ${result.transcript}` });
      } else {
        content.push({ type: "text", text: `\n### Transcript\nNo speech detected in the audio track.` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      content.push({ type: "text", text: `\n### Transcript\nTranscription unavailable: ${msg}` });
    }
  } else if (!metadata.hasAudio) {
    content.push({ type: "text", text: `\n### Transcript\nNo audio track detected in this video.` });
  }

  // Structured video summary
  content.push({
    type: "text",
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
    type: "text",
    text: [
      ``,
      `### Creative Teardown Instructions`,
      ``,
      `Perform a full creative teardown of this video ad:`,
      ``,
      `1. **Hook Analysis** (first 3s): Is this scroll-stopping? Rate the hook's shock value / pattern-interrupt strength. What grabs attention — visual hook, text overlay, movement, audio? Is it exaggerated or provocative enough?`,
      `2. **Visual Storytelling Arc**: How does the visual narrative progress?`,
      `3. **Scene Structure & Pacing**: Which scenes are longest/shortest? How does pacing drive engagement?`,
      `4. **Text Overlays & Graphics**: On-screen text, supers, graphic elements — when do they appear? Are they bold and proactive or generic?`,
      `5. **Product Presentation**: When/how is the product shown? Lifestyle vs. product-focused vs. UGC?`,
      `6. **CTA Execution**: How does the ad close? What CTA is used and how? Is it direct and urgent?`,
      `7. **Target Audience Signals**: Who is this for? Visual/copy cues indicating target demo?`,
      `8. **Emotional Triggers**: Fear, aspiration, social proof, urgency? How exaggerated are the stakes?`,
      `9. **Format & Style**: UGC, studio, motion graphics, testimonial, problem-solution?`,
      `10. **Copy Proactiveness**: Is the messaging direct and commanding, or passive and safe? Rate: Bold / Moderate / Tame.`,
      `11. **What's Working**: What makes this effective? What creative choices could be adapted?`,
      ``,
      renderTeardownGuidelines(),
    ].join("\n"),
  });

  // Angle cross-reference (when brand context is provided)
  if (opts.brandContext && opts.brandContext.angles.length > 0) {
    const bc = opts.brandContext;
    const angleList = bc.angles
      .map(
        (a, i) =>
          `${i + 1}. **${a.name}**: ${a.description}${a.hooks.length ? `\n   Hooks: ${a.hooks.join(" | ")}` : ""}`
      )
      .join("\n");

    content.push({
      type: "text",
      text: [
        ``,
        `### Angle Cross-Reference — ${bc.brand}${bc.product ? ` (${bc.product})` : ""}`,
        ``,
        bc.targetAudience ? `**Target Audience:** ${bc.targetAudience}\n` : "",
        `**Brand Messaging Angles:**`,
        angleList,
        ``,
        `For this video, evaluate each angle:`,
        ``,
        `| Angle | Alignment | Evidence | Adaptable Elements |`,
        `|-------|-----------|----------|--------------------|`,
        ...bc.angles.map(
          (a) =>
            `| **${a.name}** | _Rate: Strong / Moderate / Weak_ | _What in this video supports or contradicts this angle?_ | _Specific hooks, visuals, or structures worth adapting for ${bc.brand}_ |`
        ),
        ``,
        `**Top Angle Recommendation:** _Which angle from ${bc.brand}'s strategy best aligns with what's working in this video, and why?_`,
        ``,
        `**Adaptation Notes:** _How would you adapt this video's approach to serve ${bc.brand}'s ${bc.angles[0]?.name || "primary"} angle specifically?_`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  // Strategy pillars deep context (when loaded from brand store)
  if (opts.brandContext?.strategyPillars && opts.brandContext.strategyPillars.length > 0) {
    const bc = opts.brandContext;

    // Show product + mission if available
    const strategyHeader: string[] = [``, `### Strategy Pillars — ${bc.brand}`];
    if (bc.strategyProduct) strategyHeader.push(`**Product:** ${bc.strategyProduct}`);
    if (bc.strategyMission) {
      strategyHeader.push(
        `**Mission:** ${bc.strategyMission.goal}`,
        `**Requirements:** ${bc.strategyMission.requirements.join(" | ")}`,
        `**Negative Requirements:** ${bc.strategyMission.negative_requirements.join(" | ")}`
      );
    }

    const pillarSummary = bc.strategyPillars!
      .map((p) => {
        // Format P>S>P
        let pspLine: string;
        if (typeof p.problem_solution_promise === "object") {
          const psp = p.problem_solution_promise;
          pspLine = `Problem: ${psp.problem.slice(0, 100)}... → Promise: ${psp.promise.slice(0, 100)}...`;
        } else {
          pspLine = p.problem_solution_promise || "—";
        }

        const hookExamples = (p.example_ugc_hooks || [p.example_ugc_hook]).filter(Boolean);

        return [
          `- **${p.naming_convention || p.angle}** (P${p.priority || "—"})${p.sub_angle ? ` — ${p.sub_angle}` : ""}`,
          `  Persona: ${p.persona || "—"}${p.audience_persona ? ` | Awareness: ${p.audience_persona.awareness_level}` : ""}`,
          `  Fear: ${p.emotional_fear ? p.emotional_fear.slice(0, 150) + "..." : "—"}`,
          `  P>S>P: ${pspLine}`,
          `  Hook: "${hookExamples[0]?.slice(0, 150) || p.example_headline || "—"}..."`,
          p.key_points_framing.length ? `  Key: ${p.key_points_framing[0]?.slice(0, 100)}...` : "",
          p.output_instructions?.emotional_drivers?.length
            ? `  Emotional Drivers: ${p.output_instructions.emotional_drivers.join(", ")}`
            : "",
        ].filter(Boolean).join("\n");
      })
      .join("\n\n");

    content.push({
      type: "text",
      text: [
        ...strategyHeader,
        ``,
        pillarSummary,
        ``,
        `Cross-reference this video against the full strategy pillars:`,
        `- Which pillar's **emotional fear** does this video most tap into?`,
        `- Which pillar's **Problem>Solution>Promise** framework does this video follow?`,
        `- Could this video's hook be adapted as a **UGC hook** for any of the pillars?`,
        `- Which **objections** from the pillars does this video address (or fail to address)?`,
        `- Which **audience persona** does this video most speak to?`,
        `- Rate this video against each pillar's **key points/framing** — which are present, which are missing?`,
      ].join("\n"),
    });
  }

  // Reviews context (when loaded from brand store)
  if (opts.brandContext?.reviews && opts.brandContext.reviews.length > 0) {
    const reviews = opts.brandContext.reviews;
    const sampleReviews = reviews
      .slice(0, 5)
      .map((r) => `- (${r.source}) "${r.text.slice(0, 150)}${r.text.length > 150 ? "..." : ""}"${r.themes?.length ? ` [${r.themes.join(", ")}]` : ""}`)
      .join("\n");

    content.push({
      type: "text",
      text: [
        ``,
        `### Customer Voice — ${opts.brandContext.brand} (${reviews.length} reviews)`,
        ``,
        sampleReviews,
        reviews.length > 5 ? `_...and ${reviews.length - 5} more._` : "",
        ``,
        `Does this video's messaging mirror real customer language from the reviews?`,
        `Which review themes could strengthen the adaptation of this video for ${opts.brandContext.brand}?`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  // Top ads context (when loaded from brand store)
  if (opts.brandContext?.topAds && opts.brandContext.topAds.length > 0) {
    const ads = opts.brandContext.topAds;
    const adSummary = ads
      .slice(0, 5)
      .map(
        (a) =>
          `- **${a.brand_source}**${a.format ? ` (${a.format})` : ""}${a.headline ? `: "${a.headline}"` : ""}${a.why_it_works ? ` — ${a.why_it_works}` : ""}`
      )
      .join("\n");

    content.push({
      type: "text",
      text: [
        ``,
        `### Top-Performing Ad References — ${opts.brandContext.brand} (${ads.length} saved)`,
        ``,
        adSummary,
        ads.length > 5 ? `_...and ${ads.length - 5} more._` : "",
        ``,
        `How does this video compare to the saved top performers?`,
        `Which elements from the top performers are present or missing in this video?`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  return content;
}

// ── Tool 17: Batch Analyze Videos ────────────────────────────────────

server.tool(
  "batch_analyze_videos",
  `Analyze multiple videos at once with automatic queuing.
Processes videos in batches of 3 to avoid overloading the system.
If more than 3 videos are provided, the rest are queued and processed
as earlier batches complete. Returns combined results for all videos
once every video in the batch has been analyzed.

Each video gets the same full analysis as analyze_video:
scene extraction, transcript, structured summary, and creative teardown.

When brand context is provided (via brand_slug or inline angles), each video
is cross-referenced against the brand's strategy — scoring angle alignment,
identifying adaptable elements, and recommending which angles fit best.

Use brand_slug to auto-load the full brand context (strategy pillars, reviews,
top ads) from the brand store. Or pass inline messaging_angles for quick use.

Accepts a mix of sources (URLs, Google Drive files, local paths).`,
  {
    brand_slug: z
      .string()
      .optional()
      .describe(
        "Brand slug from setup_brand — auto-loads strategy, reviews, and top ads"
      ),
    brand: z
      .string()
      .optional()
      .describe("Client brand name (used if brand_slug is not provided)"),
    product: z
      .string()
      .optional()
      .describe("Specific product or service (override or supplement brand_slug)"),
    target_audience: z
      .string()
      .optional()
      .describe("Target audience (override or supplement brand_slug)"),
    messaging_angles: z
      .array(
        z.object({
          name: z.string().describe("Angle name (e.g. 'Social Proof', 'Problem-Solution')"),
          description: z.string().describe("What this angle communicates"),
          hooks: z
            .array(z.string())
            .default([])
            .describe("Specific hooks for this angle"),
        })
      )
      .default([])
      .describe(
        "Inline messaging angles — used if brand_slug has no strategy, or to supplement it"
      ),
    videos: z
      .array(
        z.object({
          source: z
            .enum(["url", "google_drive", "local"])
            .describe("Where to load the video from"),
          url: z.string().optional().describe("Video URL (when source is 'url')"),
          file_id: z
            .string()
            .optional()
            .describe("Google Drive file ID or share link (when source is 'google_drive')"),
          local_path: z
            .string()
            .optional()
            .describe("Absolute path to local video file (when source is 'local')"),
          label: z
            .string()
            .optional()
            .describe("Optional label for this video (e.g. brand name, ad variant)"),
        })
      )
      .min(1)
      .max(50)
      .describe("Array of videos to analyze"),
    include_transcript: z
      .boolean()
      .default(true)
      .describe("Transcribe audio via OpenAI Whisper for each video"),
    scene_threshold: z
      .number()
      .min(0.1)
      .max(0.9)
      .default(0.3)
      .describe("Scene change sensitivity (default 0.3)"),
    max_frames: z
      .number()
      .min(1)
      .max(20)
      .default(12)
      .describe("Maximum key frames per video (default 12)"),
    concurrency: z
      .number()
      .min(1)
      .max(5)
      .default(3)
      .describe("Max videos to process simultaneously (default 3)"),
  },
  async ({
    brand_slug,
    brand,
    product,
    target_audience,
    messaging_angles,
    videos,
    include_transcript,
    scene_threshold,
    max_frames,
    concurrency,
  }) => {
    // Build brand context — prefer brand_slug (loads from store), fall back to inline params
    let brandContext: AnalysisBrandContext | undefined;

    if (brand_slug) {
      const ctx = await brandStore.getFullContext(brand_slug);
      if (ctx) {
        // Convert strategy pillars to simple angles for the cross-reference table
        const anglesFromPillars = (ctx.strategy?.pillars || []).map((p) => ({
          name: p.angle,
          description: p.description || "",
          hooks: [...(p.example_ugc_hooks || [p.example_ugc_hook]), ...(p.example_headlines || [p.example_headline])].filter(Boolean) as string[],
        }));

        // Merge inline angles with pillar-derived angles (inline takes priority)
        const allAngles =
          messaging_angles.length > 0
            ? messaging_angles
            : anglesFromPillars;

        brandContext = {
          brand: ctx.profile.name,
          product: product || ctx.strategy?.product || ctx.profile.product,
          targetAudience: target_audience || ctx.profile.target_audience,
          angles: allAngles,
          strategyPillars: ctx.strategy?.pillars,
          strategyProduct: ctx.strategy?.product,
          strategyMission: ctx.strategy?.mission,
          reviews: ctx.reviews.map((r) => ({
            source: r.source,
            text: r.text,
            themes: r.themes,
          })),
          topAds: ctx.top_ads.map((a) => ({
            brand_source: a.brand_source,
            headline: a.headline,
            body_copy: a.body_copy,
            format: a.format,
            why_it_works: a.why_it_works,
          })),
        };
      }
    }

    // Fall back to inline brand + angles if no brand_slug or brand not found
    if (!brandContext && brand && messaging_angles.length > 0) {
      brandContext = {
        brand,
        product,
        targetAudience: target_audience,
        angles: messaging_angles,
      };
    }

    // Map input to VideoSource objects
    const sources: VideoSource[] = videos.map((v) => {
      if (v.source === "url") return { type: "url" as const, url: v.url! };
      if (v.source === "google_drive")
        return { type: "google_drive" as const, file_id: v.file_id! };
      return { type: "local" as const, local_path: v.local_path! };
    });

    const labels = videos.map(
      (v, i) => v.label || `Video ${i + 1}`
    );

    const batch = await processBatch(
      sources,
      {
        ingestVideo: ingestVideoFromSource,
        analyzeVideo: async (videoId: string): Promise<BatchItemResult> => {
          const content = await analyzeVideoCore(videoId, {
            includeTranscript: include_transcript,
            sceneThreshold: scene_threshold,
            maxFrames: max_frames,
            brandContext,
          });
          return { videoId, content };
        },
      },
      concurrency
    );

    // Build combined output
    const output: ContentBlock[] = [];

    const completed = batch.items.filter((it) => it.status === "completed").length;
    const failed = batch.items.filter((it) => it.status === "failed").length;
    const elapsed = batch.completedAt
      ? ((batch.completedAt.getTime() - batch.createdAt.getTime()) / 1000).toFixed(1)
      : "?";

    output.push({
      type: "text",
      text: [
        `# Batch Video Analysis Complete`,
        ``,
        `**Batch ID:** \`${batch.id}\``,
        `**Videos:** ${completed} completed, ${failed} failed (of ${batch.items.length} total)`,
        `**Concurrency:** ${concurrency} at a time`,
        `**Total time:** ${elapsed}s`,
        ``,
        `---`,
      ].join("\n"),
    });

    for (let i = 0; i < batch.items.length; i++) {
      const item = batch.items[i];
      const label = labels[i];

      output.push({
        type: "text",
        text: `\n# ${label}${item.videoId ? ` (\`${item.videoId}\`)` : ""}\n`,
      });

      if (item.status === "completed" && item.result) {
        output.push(...item.result.content);
      } else if (item.status === "failed") {
        output.push({
          type: "text",
          text: `**Failed:** ${item.error || "Unknown error"}\n`,
        });
      }

      if (i < batch.items.length - 1) {
        output.push({ type: "text", text: `\n---\n` });
      }
    }

    // Final prompt for Claude to do the comparative analysis
    if (completed > 1) {
      const comparativeLines = [
        ``,
        `---`,
        ``,
        `## Comparative Analysis Instructions`,
        ``,
        `Now that all ${completed} videos have been analyzed, provide:`,
        ``,
        `1. **Cross-Video Patterns**: Common hooks, structures, or tactics across the videos`,
        `2. **Standout Creative**: Which video(s) have the strongest creative execution and why`,
        `3. **Differentiation**: How each video approaches the same category differently`,
        `4. **Recommended Adaptations**: Key elements worth adapting for the client's next concept`,
      ];

      if (brandContext && brandContext.angles.length > 0) {
        const angleNames = brandContext.angles.map((a) => a.name).join(", ");
        comparativeLines.push(
          ``,
          `### Strategy Alignment Summary — ${brandContext.brand}`,
          ``,
          `Cross-reference all videos against ${brandContext.brand}'s messaging angles (${angleNames}):`,
          ``,
          `5. **Angle Scorecard**: For each angle, which video(s) demonstrate the strongest alignment? Rank them.`,
          `6. **Best-Fit Video per Angle**: Which single video is the best reference for each angle and why?`,
          `7. **Gap Analysis**: Are any of ${brandContext.brand}'s angles NOT well-represented across these videos? What's missing?`,
          `8. **Priority Recommendation**: Based on what's working across all videos, which 1-2 angles should ${brandContext.brand} prioritize for its next creative, and which video(s) should serve as the primary reference?`
        );
      }

      output.push({ type: "text", text: comparativeLines.join("\n") });
    }

    return { content: output };
  }
);

// ── Tool 18: Generate Ad Scripts ──────────────────────────────────────

server.tool(
  "generate_ad_scripts",
  `Generate 3 punchy, high-converting video ad script variations based on a reference
video analysis and a specified brand angle/pillar.

Each script is formatted in a standard script outline table:
Scene #, Duration, Visual Direction, Audio/Voiceover, On-Screen Text, Notes.

Use after analyze_video to turn a creative teardown into production-ready scripts.
Pass brand_slug to pull the full strategy pillar context (emotional fear, P>S>P,
example hooks, audience persona) into the scripts.`,
  {
    video_id: z.string().describe("Video ID from ingest_video (the reference ad)"),
    brand_slug: z.string().describe("Brand slug — loads strategy pillars, product, and mission"),
    pillar_name: z
      .string()
      .describe(
        "Angle or naming convention of the strategy pillar to target (e.g., 'RP-01: The Tractor Cab' or 'The Shame Remover')"
      ),
    video_analysis_summary: z
      .string()
      .describe("Claude's creative teardown from analyze_video — paste the full analysis"),
    target_duration: z
      .number()
      .default(30)
      .describe("Target video duration in seconds (default 30)"),
    format: z
      .enum(["UGC", "Studio", "Motion Graphics", "Testimonial", "Problem-Solution", "Mixed"])
      .default("UGC")
      .describe("Video ad format/style"),
    additional_direction: z
      .string()
      .optional()
      .describe("Any additional creative direction or constraints"),
  },
  async ({
    video_id,
    brand_slug,
    pillar_name,
    video_analysis_summary,
    target_duration,
    format,
    additional_direction,
  }) => {
    const ctx = await brandStore.getFullContext(brand_slug);
    if (!ctx) {
      return {
        content: [
          { type: "text" as const, text: `Brand "${brand_slug}" not found. Run \`setup_brand\` first.` },
        ],
      };
    }

    // Find the matching pillar
    const pillar = ctx.strategy?.pillars.find(
      (p) =>
        p.naming_convention.toLowerCase().includes(pillar_name.toLowerCase()) ||
        p.angle.toLowerCase().includes(pillar_name.toLowerCase()) ||
        (p.sub_angle && p.sub_angle.toLowerCase().includes(pillar_name.toLowerCase()))
    );

    if (!pillar) {
      const available = (ctx.strategy?.pillars || [])
        .map((p) => `- ${p.naming_convention || p.angle}${p.sub_angle ? ` (${p.sub_angle})` : ""}`)
        .join("\n");
      return {
        content: [
          {
            type: "text" as const,
            text: `No pillar matching "${pillar_name}" found.\n\nAvailable pillars:\n${available || "_No strategy imported yet._"}`,
          },
        ],
      };
    }

    // Build rich pillar context
    const pspSection =
      typeof pillar.problem_solution_promise === "object"
        ? [
            `**Problem:** ${pillar.problem_solution_promise.problem}`,
            `**Solution:** ${pillar.problem_solution_promise.solution}`,
            `**Promise:** ${pillar.problem_solution_promise.promise}`,
          ].join("\n")
        : `**P>S>P:** ${pillar.problem_solution_promise || "—"}`;

    const baSection =
      typeof pillar.before_after === "object"
        ? `**Before:** ${pillar.before_after.before || "—"}\n**After:** ${pillar.before_after.after || "—"}`
        : `**Before/After:** ${pillar.before_after || "—"}`;

    const hookExamples = (pillar.example_ugc_hooks || [pillar.example_ugc_hook]).filter(Boolean);
    const headlineExamples = (pillar.example_headlines || [pillar.example_headline]).filter(Boolean);

    const brief = [
      `## Script Generation Brief`,
      ``,
      `**Brand:** ${ctx.profile.name}`,
      `**Product:** ${ctx.strategy?.product || ctx.profile.product || "—"}`,
      `**Video ID:** \`${video_id}\``,
      `**Target Duration:** ${target_duration}s`,
      `**Format:** ${format}`,
      additional_direction ? `**Direction:** ${additional_direction}` : null,
      ``,
      `---`,
      ``,
      `### Target Angle: ${pillar.naming_convention || pillar.angle}`,
      pillar.sub_angle ? `**Sub-Angle:** ${pillar.sub_angle}` : null,
      `**Persona:** ${pillar.persona || "—"}`,
      pillar.audience_persona
        ? `**Audience:** ${pillar.audience_persona.type} (${pillar.audience_persona.awareness_level})`
        : null,
      `**Benefits:** ${pillar.primary_benefits.join(", ") || "—"}`,
      ``,
      `### Emotional Fear`,
      pillar.emotional_fear || "—",
      ``,
      `### Problem > Solution > Promise`,
      pspSection,
      ``,
      `### Before / After`,
      baSection,
      ``,
      `### Example Headlines`,
      ...headlineExamples.map((h, i) => `${i + 1}. ${h}`),
      ``,
      `### Example UGC Hooks`,
      ...hookExamples.map((h, i) => `${i + 1}. ${h}`),
      ``,
      `### Key Points / Framing`,
      ...pillar.key_points_framing.map((k) => `- ${k}`),
      pillar.output_instructions?.emotional_drivers?.length
        ? `\n### Emotional Drivers\n${pillar.output_instructions.emotional_drivers.map((d) => `- ${d}`).join("\n")}`
        : null,
      ``,
      `---`,
      ``,
      `### Reference Video Analysis`,
      video_analysis_summary,
      ``,
      `---`,
      ``,
      renderCreativeGuidelines(),
      ``,
      ctx.strategy?.mission
        ? [
            `### Product-Specific Mission`,
            `**Goal:** ${ctx.strategy.mission.goal}`,
            `**Requirements:** ${ctx.strategy.mission.requirements.map((r) => `\n- ${r}`).join("")}`,
            `**Negative Requirements:** ${ctx.strategy.mission.negative_requirements.map((r) => `\n- ${r}`).join("")}`,
          ].join("\n")
        : null,
      ``,
      `---`,
      ``,
      `## Instructions for Claude`,
      ``,
      `Generate **3 distinct script variations** for a ${target_duration}-second ${format} video ad.`,
      `Each script targets the **${pillar.naming_convention || pillar.angle}** angle${pillar.sub_angle ? ` / ${pillar.sub_angle} sub-angle` : ""}.`,
      ``,
      `Each variation MUST:`,
      `- Open with a **different scroll-stopping hook** from the angle's examples or inspired by the reference video`,
      `- Follow the **Problem > Solution > Promise** framework from the pillar`,
      `- Tap the **emotional fear** specific to this angle`,
      `- Use authentic, review-inspired language (not ad-speak)`,
      `- End with a direct, urgent CTA`,
      ``,
      `**Format each script as a table:**`,
      ``,
      `### Script [#]: "[Variation Name]"`,
      `**Hook Type:** [e.g., Shock Stat, Confession, UGC Cold Open]`,
      `**Emotional Driver:** [Primary emotion this variation targets]`,
      ``,
      `| Scene | Time | Visual | Audio / Voiceover | On-Screen Text | Notes |`,
      `|-------|------|--------|-------------------|----------------|-------|`,
      `| 1 | 0-3s | [Hook visual] | "[Opening line]" | [BOLD TEXT] | Pattern interrupt |`,
      `| 2 | 3-Xs | [Problem visual] | "[Problem VO]" | [Stats/text] | Build tension |`,
      `| ... | ... | ... | ... | ... | ... |`,
      `| N | Xs-${target_duration}s | [CTA visual] | "[CTA line]" | [CTA TEXT] | Urgency close |`,
      ``,
      `After all 3 scripts, provide:`,
      `1. **Variation Comparison** — which variation is strongest for cold traffic vs. retargeting vs. social proof`,
      `2. **Production Notes** — talent requirements, key props, shooting considerations`,
      `3. **Recommended A/B Test** — which 2 variations to test first and why`,
    ]
      .filter((line) => line !== null)
      .join("\n");

    return {
      content: [{ type: "text" as const, text: brief }],
    };
  }
);

// ── Tool 19: Analyze Image Ad ────────────────────────────────────────

server.tool(
  "analyze_image_ad",
  `Perform a creative teardown of a reference image ad (static, carousel frame, etc.).
Accepts images from a URL, Google Drive, or local file path.

Returns the image for Claude to see and a structured creative teardown prompt
covering hook, copy analysis, visual hierarchy, emotional triggers, and more.

Pass brand_slug to cross-reference against the brand's strategy pillars.`,
  {
    source: z
      .enum(["url", "google_drive", "local"])
      .describe("Where to load the image from"),
    url: z
      .string()
      .optional()
      .describe("Image URL (required when source is 'url')"),
    file_id: z
      .string()
      .optional()
      .describe("Google Drive file ID or share link (required when source is 'google_drive')"),
    local_path: z
      .string()
      .optional()
      .describe("Absolute path to local image file (required when source is 'local')"),
    brand_slug: z
      .string()
      .optional()
      .describe("Brand slug — auto-loads strategy pillars for cross-referencing"),
    ad_context: z
      .string()
      .optional()
      .describe("Any known context about the ad (brand, platform, campaign, etc.)"),
  },
  async ({ source, url, file_id, local_path, brand_slug, ad_context }) => {
    const content: ContentBlock[] = [];
    let imageBase64: string;
    let mimeType: string;
    let imageName = "image";

    try {
      if (source === "url") {
        if (!url) {
          return {
            content: [{ type: "text" as const, text: "Please provide a `url` when source is 'url'." }],
          };
        }
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status} ${resp.statusText}`);
        const buffer = Buffer.from(await resp.arrayBuffer());
        imageBase64 = buffer.toString("base64");
        mimeType = resp.headers.get("content-type") || "image/jpeg";
        imageName = url.split("/").pop()?.split("?")[0] || "image";
      } else if (source === "google_drive") {
        if (!file_id) {
          return {
            content: [{ type: "text" as const, text: "Please provide a `file_id` when source is 'google_drive'." }],
          };
        }
        let driveFileId = file_id;
        const driveUrlMatch = file_id.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (driveUrlMatch) driveFileId = driveUrlMatch[1];

        const drive = getGoogleDriveService();
        const { buffer, name, mimeType: mt } = await drive.downloadFile(driveFileId);
        imageBase64 = buffer.toString("base64");
        mimeType = mt || "image/jpeg";
        imageName = name;
      } else {
        if (!local_path) {
          return {
            content: [{ type: "text" as const, text: "Please provide a `local_path` when source is 'local'." }],
          };
        }
        const fs = await import("fs/promises");
        const buffer = await fs.readFile(local_path);
        imageBase64 = buffer.toString("base64");
        const ext = local_path.split(".").pop()?.toLowerCase() || "jpg";
        const mimeMap: Record<string, string> = {
          jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
          gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
        };
        mimeType = mimeMap[ext] || "image/jpeg";
        imageName = local_path.split("/").pop() || "image";
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Failed to load image: ${msg}` }],
      };
    }

    // Show the image
    content.push(
      { type: "text", text: `## Image Ad Analysis — ${imageName}\n` },
      { type: "image", data: imageBase64, mimeType }
    );

    // Add ad context if provided
    if (ad_context) {
      content.push({ type: "text", text: `\n**Context:** ${ad_context}\n` });
    }

    // Creative teardown prompt for image ads
    content.push({
      type: "text",
      text: [
        ``,
        `### Image Ad Summary`,
        ``,
        `Fill in these structured fields based on the image above:`,
        ``,
        `| Field | Value |`,
        `|-------|-------|`,
        `| **Ad Type** | _Static / Carousel Frame / Story / Other_ |`,
        `| **Brand** | _Identify from logo, text, or context_ |`,
        `| **Headline** | _Primary headline text if visible_ |`,
        `| **Body Copy** | _Any body/description text_ |`,
        `| **CTA** | _Call-to-action button or text_ |`,
        `| **Platform** | _Facebook / Instagram / Other (infer from format)_ |`,
        `| **Aspect Ratio** | _1:1 / 4:5 / 9:16 / 16:9_ |`,
        ``,
        `### Creative Teardown`,
        ``,
        `1. **Visual Hook**: What grabs attention first? Rate scroll-stop power (1-10). Is it bold, provocative, or pattern-interrupting enough?`,
        `2. **Visual Hierarchy**: Eye path — what do you see 1st, 2nd, 3rd? How does the layout guide the viewer?`,
        `3. **Headline Analysis**: Is the headline scroll-stopping? Does it hook in under 2 seconds? Rate: Bold / Moderate / Tame.`,
        `4. **Copy Analysis**: Primary text tone — proactive or passive? Does it create urgency? Use specific numbers?`,
        `5. **Color & Contrast**: Dominant colors, contrast strategy, brand consistency. Does it stand out in a feed?`,
        `6. **Typography**: Font choices, hierarchy, readability. Bold enough to read on mobile?`,
        `7. **Product Presentation**: How is the product shown? Hero shot, lifestyle, UGC-style, comparison?`,
        `8. **Emotional Triggers**: What emotions does this ad target? Fear, aspiration, social proof, curiosity, urgency?`,
        `9. **Social Proof**: Reviews, ratings, testimonials, user counts, or trust badges present?`,
        `10. **CTA Execution**: Is the CTA clear, direct, and urgent? Or buried/weak?`,
        `11. **Target Audience Signals**: Who is this for? Visual and copy cues indicating target demo.`,
        `12. **What's Working**: What makes this effective? Key elements worth adapting.`,
        `13. **What's Weak**: What could be improved? Missed opportunities.`,
        ``,
        renderTeardownGuidelines(),
      ].join("\n"),
    });

    // Brand cross-reference
    if (brand_slug) {
      const ctx = await brandStore.getFullContext(brand_slug);
      if (ctx && ctx.strategy?.pillars.length) {
        const angleList = ctx.strategy.pillars
          .map(
            (p, i) =>
              `${i + 1}. **${p.naming_convention || p.angle}**${p.sub_angle ? ` — ${p.sub_angle}` : ""}: ${p.emotional_fear ? p.emotional_fear.slice(0, 100) + "..." : p.description || "—"}`
          )
          .join("\n");

        content.push({
          type: "text",
          text: [
            ``,
            `### Angle Cross-Reference — ${ctx.profile.name}${ctx.strategy.product ? ` (${ctx.strategy.product})` : ""}`,
            ``,
            `**Strategy Pillars:**`,
            angleList,
            ``,
            `For this image ad, evaluate each angle:`,
            ``,
            `| Angle | Alignment | Evidence | Adaptable Elements |`,
            `|-------|-----------|----------|--------------------|`,
            ...ctx.strategy.pillars.map(
              (p) =>
                `| **${p.naming_convention || p.angle}** | _Strong / Moderate / Weak_ | _What in this image supports this angle?_ | _Visuals, copy, or structure worth adapting_ |`
            ),
            ``,
            `**Top Angle Recommendation:** _Which angle best aligns with this image ad's approach?_`,
            `**Script Adaptation Notes:** _How would you translate this image ad's strongest elements into a video script for ${ctx.profile.name}?_`,
          ].join("\n"),
        });
      }
    }

    return { content };
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
