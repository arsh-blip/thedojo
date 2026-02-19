import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { MetaAdLibraryService } from "./services/meta-ad-library.js";
import { GoogleDriveService } from "./services/google-drive.js";
import { GoogleSlidesService } from "./services/google-slides.js";
import { VideoAnalyzerService } from "./services/video-analyzer.js";
import { AdCatalogService } from "./services/ad-catalog.js";
import { createOAuth2Client } from "./services/google-auth.js";
import type {
  FacebookAd,
  AdCopy,
  AngleRecommendation,
  ConceptSlideData,
  VideoAdCatalog,
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

function getVideoAnalyzerService(): VideoAnalyzerService {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new VideoAnalyzerService(key);
}

const adCatalog = new AdCatalogService();

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

// ── Tool 7: Transcribe Video ──────────────────────────────────────────

server.tool(
  "transcribe_video",
  `Transcribe the audio from a single video file using OpenAI Whisper.
Returns the full transcript as plain text. This is a lightweight alternative to
analyze_video_ads when you only need the transcript from one video — no frames,
metadata, or cataloging overhead.

Requires ffmpeg to be installed on the system.`,
  {
    file_path: z
      .string()
      .describe(
        "Absolute path to the video file (mp4, mov, avi, webm, mkv, m4v)"
      ),
  },
  async ({ file_path: filePath }) => {
    const analyzer = getVideoAnalyzerService();

    // Validate extension
    const ext = path.extname(filePath).toLowerCase();
    const supported = [".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"];
    if (!supported.includes(ext)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Unsupported file type "${ext}". Supported formats: ${supported.join(", ")}`,
          },
        ],
      };
    }

    try {
      const transcript = await analyzer.transcribeVideo(filePath);

      if (!transcript) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No speech detected in "${path.basename(filePath)}". The video may have no audio track or contain only music/silence.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `## Transcript: ${path.basename(filePath)}\n\n${transcript}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error transcribing "${path.basename(filePath)}": ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

// ── Tool 8: Analyze Video Ads ────────────────────────────────────────

server.tool(
  "analyze_video_ads",
  `Bulk-analyze a folder of video ads. Extracts key frames, metadata, and audio transcripts
(via OpenAI Whisper) for every video in the folder. Results are saved to a JSON catalog file
that can be queried with query_ad_catalog.

When analyze_visuals is enabled, each extracted frame is analyzed with GPT-4o vision to:
- Describe the visual content (product shots, lifestyle, UGC, etc.)
- Detect burned-in captions, subtitles, and text overlays
- Identify caption-free segments ideal for clipping and repurposing

Requires ffmpeg and ffprobe to be installed on the system.
Supports incremental processing — already-analyzed videos are skipped by default.`,
  {
    folder_path: z
      .string()
      .describe(
        "Absolute path to the folder containing video files (mp4, mov, avi, webm, mkv, m4v)"
      ),
    brand_name: z
      .string()
      .describe("Brand name for cataloging (e.g. 'Glossier')"),
    catalog_path: z
      .string()
      .optional()
      .describe(
        "Custom path for the catalog JSON file. Defaults to {folder_path}/ad_catalog.json"
      ),
    frame_interval_seconds: z
      .number()
      .min(1)
      .max(30)
      .default(5)
      .describe(
        "Extract one frame every N seconds (default: 5). Lower = more frames."
      ),
    max_frames_per_video: z
      .number()
      .min(1)
      .max(30)
      .default(10)
      .describe("Maximum number of key frames to extract per video (default: 10)"),
    max_videos: z
      .number()
      .min(1)
      .optional()
      .describe(
        "Process at most N videos (useful for batching large folders). Omit to process all."
      ),
    skip_existing: z
      .boolean()
      .default(true)
      .describe("Skip videos that are already in the catalog (default: true)"),
    analyze_visuals: z
      .boolean()
      .default(false)
      .describe(
        "Analyze each frame with GPT-4o vision to detect text overlays, captions, and scene types. " +
        "Identifies caption-free segments ideal for clipping. Uses OpenAI API credits per frame (default: false)."
      ),
  },
  async ({
    folder_path,
    brand_name,
    catalog_path,
    frame_interval_seconds,
    max_frames_per_video,
    max_videos,
    skip_existing,
    analyze_visuals,
  }) => {
    const analyzer = getVideoAnalyzerService();
    const catPath = catalog_path ?? path.join(folder_path, "ad_catalog.json");
    const framesDir = path.join(folder_path, "_frames");

    // Load existing catalog or create new one
    let catalog = await adCatalog.load(catPath);
    const isNew = !catalog;
    if (!catalog) {
      catalog = {
        brand: brand_name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        source_folder: folder_path,
        videos: [],
      };
    }

    // List all videos in the folder
    let allVideos: string[];
    try {
      allVideos = await analyzer.listVideos(folder_path);
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error reading folder "${folder_path}": ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }

    if (allVideos.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No video files found in "${folder_path}". Supported formats: mp4, mov, avi, webm, mkv, m4v.`,
          },
        ],
      };
    }

    // Filter out already-analyzed videos if requested
    const analyzed = skip_existing
      ? adCatalog.getAnalyzedFilenames(catalog)
      : new Set<string>();
    let toProcess = allVideos.filter(
      (v) => !analyzed.has(path.basename(v))
    );

    if (max_videos) {
      toProcess = toProcess.slice(0, max_videos);
    }

    if (toProcess.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `All ${allVideos.length} videos in "${folder_path}" have already been analyzed.\n\n${adCatalog.summarize(catalog)}`,
          },
        ],
      };
    }

    // Process videos sequentially
    const errors: string[] = [];
    let processed = 0;

    for (const videoPath of toProcess) {
      try {
        const entry = await analyzer.analyzeVideo(videoPath, framesDir, {
          frameIntervalSeconds: frame_interval_seconds,
          maxFramesPerVideo: max_frames_per_video,
          analyzeVisuals: analyze_visuals,
        });
        catalog.videos.push(entry);
        processed++;
      } catch (err) {
        errors.push(
          `${path.basename(videoPath)}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Save catalog
    catalog.updated_at = new Date().toISOString();
    await adCatalog.save(catPath, catalog);

    // Build response
    const summary = adCatalog.summarize(catalog);
    const errorReport =
      errors.length > 0
        ? `\n\n### Errors (${errors.length})\n${errors.map((e) => `- ${e}`).join("\n")}`
        : "";

    return {
      content: [
        {
          type: "text" as const,
          text: `Processed ${processed}/${toProcess.length} videos (${allVideos.length} total in folder).${isNew ? " New catalog created." : " Catalog updated."}${analyze_visuals ? " Visual analysis enabled (GPT-4o)." : ""}\n\nCatalog saved to: ${catPath}\nKey frames saved to: ${framesDir}\n\n${summary}${errorReport}`,
        },
      ],
    };
  }
);

// ── Tool 9: Query Ad Catalog ────────────────────────────────────────

server.tool(
  "query_ad_catalog",
  `Search and filter the analyzed video ad catalog. Use this after running analyze_video_ads
to find specific ads by transcript content, duration, aspect ratio, or filename.
Returns metadata, transcripts, and key frame paths for matching ads.

When visual analysis has been run (analyze_visuals=true), you can also filter by:
- has_captions: find videos with or without burned-in text overlays
- caption_free_only: find only videos that have caption-free segments (ideal for clipping)
- scene_type: filter by visual scene type (product_shot, lifestyle, ugc_talking_head, etc.)`,
  {
    catalog_path: z
      .string()
      .describe("Path to the ad_catalog.json file"),
    search_text: z
      .string()
      .optional()
      .describe(
        "Search transcripts and filenames for this text (case-insensitive)"
      ),
    min_duration: z
      .number()
      .optional()
      .describe("Minimum video duration in seconds"),
    max_duration: z
      .number()
      .optional()
      .describe("Maximum video duration in seconds"),
    aspect_ratio: z
      .enum(["16:9", "9:16", "4:5", "1:1"])
      .optional()
      .describe("Filter by aspect ratio"),
    has_captions: z
      .boolean()
      .optional()
      .describe(
        "Filter by caption presence. true = has text overlays, false = no text overlays. " +
        "Requires analyze_visuals to have been run."
      ),
    caption_free_only: z
      .boolean()
      .optional()
      .describe(
        "If true, only return videos that have at least one caption-free segment " +
        "(ideal for clipping without needing to hide text). Requires analyze_visuals."
      ),
    scene_type: z
      .enum([
        "product_shot",
        "lifestyle",
        "ugc_talking_head",
        "text_card",
        "logo_endcard",
        "unboxing",
        "before_after",
        "testimonial",
        "demo",
        "other",
      ])
      .optional()
      .describe("Filter by scene type detected in frame analysis"),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of results to return (default: 10)"),
  },
  async ({ catalog_path, search_text, min_duration, max_duration, aspect_ratio, has_captions, caption_free_only, scene_type, limit }) => {
    const catalog = await adCatalog.load(catalog_path);

    if (!catalog) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No catalog found at "${catalog_path}". Run analyze_video_ads first to create one.`,
          },
        ],
      };
    }

    const results = adCatalog.search(catalog, {
      search_text,
      min_duration,
      max_duration,
      aspect_ratio,
      has_captions,
      caption_free_only,
      scene_type,
      limit,
    });

    if (results.length === 0) {
      const filters = [
        search_text ? `text="${search_text}"` : null,
        min_duration !== undefined ? `min_duration=${min_duration}s` : null,
        max_duration !== undefined ? `max_duration=${max_duration}s` : null,
        aspect_ratio ? `aspect_ratio=${aspect_ratio}` : null,
        has_captions !== undefined ? `has_captions=${has_captions}` : null,
        caption_free_only ? `caption_free_only=true` : null,
        scene_type ? `scene_type=${scene_type}` : null,
      ]
        .filter(Boolean)
        .join(", ");

      return {
        content: [
          {
            type: "text" as const,
            text: `No videos found matching filters: ${filters}.\n\n${adCatalog.summarize(catalog)}`,
          },
        ],
      };
    }

    const formatted = results.map((r) => adCatalog.formatEntry(r));

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${results.length} matching video(s) from ${catalog.brand} catalog (${catalog.videos.length} total):\n\n${formatted.join("\n\n---\n\n")}`,
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
