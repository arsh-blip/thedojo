import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MetaAdLibraryService } from "./services/meta-ad-library.js";
import { GoogleDriveService } from "./services/google-drive.js";
import { GoogleSlidesService } from "./services/google-slides.js";
import { createOAuth2Client } from "./services/google-auth.js";
import type {
  FacebookAd,
  AdCopy,
  AngleRecommendation,
  ConceptSlideData,
  AssetAnalysisResult,
} from "./types.js";
import {
  scanLocalFolder,
  scanDriveFolder,
  processNextBatch,
  getQueueStatus,
  getAnalysisResults,
  listQueues,
} from "./services/asset-queue.js";

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

// ── Tool 7: Scan Asset Folder ────────────────────────────────────────

server.tool(
  "scan_asset_folder",
  `Scan a folder of creative assets (local path or Google Drive folder) and create a processing queue.
Use this when a brand sends a batch of videos, images, or other creative files that need to be
analyzed before use. The queue will process assets in configurable batches (default: 2 at a time).

Returns a queue ID that you use with process_next_batch to work through the assets.
Supports: video (MP4, MOV, WebM), images (JPG, PNG, WebP, GIF), audio, PDFs, PSD, and more.`,
  {
    source: z
      .enum(["local", "google_drive"])
      .describe("Where the assets are stored"),
    folder_path: z
      .string()
      .describe(
        "Local folder path (for 'local' source) or Google Drive folder ID (for 'google_drive' source)"
      ),
    batch_size: z
      .number()
      .min(1)
      .max(20)
      .default(2)
      .describe(
        "Number of assets to process per batch (default: 2)"
      ),
    queue_name: z
      .string()
      .optional()
      .describe(
        "Optional name for this queue (e.g. brand name or campaign)"
      ),
  },
  async ({ source, folder_path, batch_size, queue_name }) => {
    try {
      let queue;

      if (source === "local") {
        queue = await scanLocalFolder(folder_path, batch_size, queue_name);
      } else {
        const drive = getGoogleDriveService();
        queue = await scanDriveFolder(
          drive,
          folder_path,
          batch_size,
          queue_name
        );
      }

      if (queue.totalAssets === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No creative assets found in ${source === "local" ? `folder "${folder_path}"` : `Drive folder "${folder_path}"`}. Supported formats: video (MP4, MOV, WebM), images (JPG, PNG, WebP, GIF), audio, PDF, PSD.`,
            },
          ],
        };
      }

      // Summarize what was found by type
      const typeCounts: Record<string, number> = {};
      for (const asset of queue.assets) {
        const ext =
          asset.filename.split(".").pop()?.toLowerCase() || "unknown";
        typeCounts[ext] = (typeCounts[ext] || 0) + 1;
      }
      const typeBreakdown = Object.entries(typeCounts)
        .map(([ext, count]) => `${count} .${ext}`)
        .join(", ");

      return {
        content: [
          {
            type: "text" as const,
            text: `## Queue Created: ${queue.name}

**Queue ID:** \`${queue.id}\`
**Source:** ${source === "local" ? folder_path : `Google Drive folder ${folder_path}`}
**Total assets:** ${queue.totalAssets}
**Batch size:** ${queue.batchSize}
**Breakdown:** ${typeBreakdown}

The queue is ready. Call \`process_next_batch\` with queue_id \`${queue.id}\` to start analyzing the first batch of ${Math.min(queue.batchSize, queue.totalAssets)} assets.

**Agentic workflow:** Keep calling \`process_next_batch\` until all assets are analyzed. Use \`get_queue_status\` to check progress at any time.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to scan folder: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

// ── Tool 8: Process Next Batch ──────────────────────────────────────

server.tool(
  "process_next_batch",
  `Process the next batch of assets in a queue. Each call analyzes the next N assets (where N is
the queue's batch size) — extracting file metadata, checking Meta ad spec compliance, and
generating tags and summaries.

Call this repeatedly to work through the entire queue. The tool tells you how many assets remain
so you know when to stop. This is the core of the agentic loop — each batch returns structured
analysis that you can reason about before processing the next batch.`,
  {
    queue_id: z.string().describe("The queue ID returned by scan_asset_folder"),
  },
  async ({ queue_id }) => {
    const driveService = (() => {
      try {
        return getGoogleDriveService();
      } catch {
        return undefined;
      }
    })();

    const result = await processNextBatch(queue_id, driveService);

    if (!result) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Queue \`${queue_id}\` not found. Use \`scan_asset_folder\` first to create a queue, or \`get_queue_status\` to list active queues.`,
          },
        ],
      };
    }

    if (result.batchResults.length === 0 && result.queueComplete) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Queue is already complete — all assets have been processed. Use \`get_analysis_results\` to retrieve the full results.`,
          },
        ],
      };
    }

    const batchSummary = result.batchResults
      .map((r) => formatAnalysisResult(r))
      .join("\n\n---\n\n");

    const statusLine = result.queueComplete
      ? "**Queue complete!** All assets have been analyzed."
      : `**${result.remaining} assets remaining.** Call \`process_next_batch\` again to continue.`;

    return {
      content: [
        {
          type: "text" as const,
          text: `## Batch Analysis Complete (${result.batchResults.length} assets)\n\n${batchSummary}\n\n---\n\n${statusLine}`,
        },
      ],
    };
  }
);

// ── Tool 9: Get Queue Status ────────────────────────────────────────

server.tool(
  "get_queue_status",
  `Check the current status of an asset processing queue, or list all active queues.
Shows counts of pending, processing, completed, and failed assets.`,
  {
    queue_id: z
      .string()
      .optional()
      .describe(
        "Specific queue ID to check. Omit to list all active queues."
      ),
  },
  async ({ queue_id }) => {
    // List all queues if no ID provided
    if (!queue_id) {
      const allQueues = listQueues();
      if (allQueues.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No active queues. Use `scan_asset_folder` to create one.",
            },
          ],
        };
      }

      const list = allQueues
        .map(
          (q) =>
            `- **${q.name}** (\`${q.id}\`): ${q.status} — ${q.completed}/${q.total} completed`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `## Active Queues\n\n${list}`,
          },
        ],
      };
    }

    const status = getQueueStatus(queue_id);
    if (!status) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Queue \`${queue_id}\` not found.`,
          },
        ],
      };
    }

    const progressBar = makeProgressBar(status.completed, status.total);

    return {
      content: [
        {
          type: "text" as const,
          text: `## Queue: ${status.name}

**Status:** ${status.status}
**Progress:** ${progressBar} ${status.completed}/${status.total}

| State | Count |
|-------|-------|
| Pending | ${status.pending} |
| Processing | ${status.processing} |
| Completed | ${status.completed} |
| Failed | ${status.failed} |

**Batch size:** ${status.batchSize}
${status.pending > 0 ? `\nCall \`process_next_batch\` to process the next ${Math.min(status.batchSize, status.pending)} assets.` : "\nAll assets have been processed. Use `get_analysis_results` to retrieve results."}`,
        },
      ],
    };
  }
);

// ── Tool 10: Get Analysis Results ───────────────────────────────────

server.tool(
  "get_analysis_results",
  `Retrieve completed analysis results from a processing queue.
Returns detailed metadata, ad spec compliance, and tags for all analyzed assets.
Use this after processing batches to get a consolidated view of all results.`,
  {
    queue_id: z
      .string()
      .describe("The queue ID to retrieve results from"),
    filter_type: z
      .enum(["all", "video", "image", "document", "audio", "other"])
      .default("all")
      .describe("Filter results by asset type"),
    only_failures: z
      .boolean()
      .default(false)
      .describe("Only show assets that failed ad spec checks"),
  },
  async ({ queue_id, filter_type, only_failures }) => {
    const results = getAnalysisResults(queue_id);

    if (!results) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Queue \`${queue_id}\` not found.`,
          },
        ],
      };
    }

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No completed analyses yet. Use \`process_next_batch\` to start processing.`,
          },
        ],
      };
    }

    let filtered = results;

    if (filter_type !== "all") {
      filtered = filtered.filter((r) => r.fileType === filter_type);
    }

    if (only_failures) {
      filtered = filtered.filter((r) =>
        r.adSpecCompliance.some((c) => !c.passed)
      );
    }

    if (filtered.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No results match the filter (type: ${filter_type}, only_failures: ${only_failures}). ${results.length} total results available.`,
          },
        ],
      };
    }

    const formatted = filtered.map((r) => formatAnalysisResult(r)).join("\n\n---\n\n");

    // Build a quick summary
    const typeBreakdown: Record<string, number> = {};
    for (const r of filtered) {
      typeBreakdown[r.fileType] = (typeBreakdown[r.fileType] || 0) + 1;
    }
    const specFailures = filtered.filter((r) =>
      r.adSpecCompliance.some((c) => !c.passed)
    ).length;

    const summaryParts = [
      `**${filtered.length} assets**`,
      Object.entries(typeBreakdown)
        .map(([type, count]) => `${count} ${type}`)
        .join(", "),
      specFailures > 0
        ? `${specFailures} with ad spec issues`
        : "all passing ad spec checks",
    ];

    return {
      content: [
        {
          type: "text" as const,
          text: `## Analysis Results\n\n${summaryParts.join(" | ")}\n\n${formatted}`,
        },
      ],
    };
  }
);

// ── Helpers ─────────────────────────────────────────────────────────

function formatAnalysisResult(r: AssetAnalysisResult): string {
  const specLines = r.adSpecCompliance
    .map((c) => `  ${c.passed ? "PASS" : "FAIL"} ${c.spec}: ${c.message}`)
    .join("\n");

  const parts = [
    `### ${r.filename}`,
    `**Type:** ${r.fileType} (${r.mimeType})`,
    `**Size:** ${formatBytes(r.fileSize)}`,
  ];

  if (r.dimensions) {
    parts.push(`**Dimensions:** ${r.dimensions.width}x${r.dimensions.height}`);
  }
  if (r.durationSeconds !== undefined) {
    parts.push(`**Duration:** ${r.durationSeconds}s`);
  }

  parts.push(`**Tags:** ${r.tags.join(", ")}`);
  parts.push(`**Ad Spec Compliance:**\n${specLines}`);
  parts.push(`**Summary:** ${r.summary}`);

  return parts.join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function makeProgressBar(completed: number, total: number): string {
  const pct = total === 0 ? 100 : Math.round((completed / total) * 100);
  const filled = Math.round(pct / 5);
  return "[" + "#".repeat(filled) + "-".repeat(20 - filled) + "] " + pct + "%";
}

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
