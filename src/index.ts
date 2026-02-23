import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MetaAdLibraryService } from "./services/meta-ad-library.js";
import { GoogleDriveService } from "./services/google-drive.js";
import { GoogleSlidesService } from "./services/google-slides.js";
import { createOAuth2Client } from "./services/google-auth.js";
import { VideoAnalyzerService } from "./services/video-analyzer.js";
import { PremiereXmlGeneratorService } from "./services/premiere-xml-generator.js";
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

function getVideoAnalyzerService(): VideoAnalyzerService {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new VideoAnalyzerService(apiKey);
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

// ── Tool 7: Browse Drive Folder ──────────────────────────────────────

server.tool(
  "browse_drive",
  `Browse a Google Drive folder to see its contents (files and subfolders).
Use this to navigate the client folder structure: Clients → [Client] → Creative Briefs / Creative Exports.
Provide a folder_id to list its contents, or use the default Clients root folder.`,
  {
    folder_id: z
      .string()
      .optional()
      .describe(
        "Google Drive folder ID to browse. Defaults to the Clients root folder (1ttQlzxwqEqvt3keHwKAcXn33TnkT5bos)"
      ),
  },
  async ({ folder_id }) => {
    const drive = getGoogleDriveService();
    const targetId = folder_id || "1ttQlzxwqEqvt3keHwKAcXn33TnkT5bos";

    try {
      // Get folder metadata
      const folderMeta = await drive.getFileMetadata(targetId);
      const items = await drive.listFolder(targetId);

      if (items.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `## 📁 ${folderMeta.name}\n\nThis folder is empty.\n\nFolder ID: \`${targetId}\``,
            },
          ],
        };
      }

      const folders = items.filter((i) => i.isFolder);
      const files = items.filter((i) => !i.isFolder);

      let output = `## 📁 ${folderMeta.name}\n\nFolder ID: \`${targetId}\`\n`;

      if (folders.length > 0) {
        output += `\n### Folders (${folders.length})\n`;
        output += folders
          .map((f) => `- 📁 **${f.name}** — ID: \`${f.id}\``)
          .join("\n");
      }

      if (files.length > 0) {
        output += `\n\n### Files (${files.length})\n`;
        output += files
          .map((f) => {
            const type = getMimeLabel(f.mimeType);
            return `- ${type} **${f.name}** — ID: \`${f.id}\``;
          })
          .join("\n");
      }

      return {
        content: [{ type: "text" as const, text: output }],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error browsing folder: ${err.message}`,
          },
        ],
      };
    }
  }
);

// ── Tool 8: Setup Client Folder ──────────────────────────────────────

server.tool(
  "setup_client_folder",
  `Create the standard folder structure for a client in the Clients Drive folder.
Creates: [Client Name]/ with Creative Briefs/ and Creative Exports/ subfolders.
If the folders already exist, they won't be duplicated.`,
  {
    client_name: z
      .string()
      .describe("Client name (e.g. 'Reliant Pet', 'ULTRA')"),
    clients_root_id: z
      .string()
      .default("1ttQlzxwqEqvt3keHwKAcXn33TnkT5bos")
      .describe("Root Clients folder ID"),
  },
  async ({ client_name, clients_root_id }) => {
    const drive = getGoogleDriveService();

    try {
      const result = await drive.createClientFolderStructure(
        client_name,
        clients_root_id
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `## Client Folder Structure Created

**${client_name}** — ID: \`${result.clientFolder.id}\`
├── Creative Briefs — ID: \`${result.creativeBriefs.id}\`
└── Creative Exports — ID: \`${result.creativeExports.id}\`

Browse: Use \`browse_drive\` with folder ID \`${result.clientFolder.id}\` to view contents.`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error creating folder structure: ${err.message}`,
          },
        ],
      };
    }
  }
);

// ── Tool 9: Create Concept Brief ─────────────────────────────────────

server.tool(
  "create_concept_brief",
  `Create a new concept brief (Google Slides presentation) in a client's Creative Briefs folder.
Can either create from scratch or copy an existing template presentation.
Names the file using the standard convention: [Code] - [Name] - [Type] - [Status].`,
  {
    client_name: z.string().describe("Client brand name"),
    concept_code: z
      .string()
      .describe(
        "Concept code prefix (e.g. 'K143', 'G109', 'R52')"
      ),
    concept_name: z
      .string()
      .describe("Concept name (e.g. 'Morning Routine', 'Hero Testimonial')"),
    concept_type: z
      .enum(["Static", "Video"])
      .describe("Whether this is a static image or video concept"),
    status: z
      .enum(["New", "Iteration"])
      .default("New")
      .describe("Concept status"),
    briefs_folder_id: z
      .string()
      .describe("ID of the Creative Briefs folder to create in"),
    template_file_id: z
      .string()
      .optional()
      .describe(
        "Optional: ID of an existing concept brief to copy as template"
      ),
  },
  async ({
    client_name,
    concept_code,
    concept_name,
    concept_type,
    status,
    briefs_folder_id,
    template_file_id,
  }) => {
    const drive = getGoogleDriveService();
    const fileName = `${concept_code} - ${concept_name} - ${concept_type} - ${status}`;

    try {
      let file;
      if (template_file_id) {
        file = await drive.copyFile(
          template_file_id,
          fileName,
          briefs_folder_id
        );
      } else {
        file = await drive.createPresentation(fileName, briefs_folder_id);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `## Concept Brief Created

**${fileName}**
- Type: Google Slides Presentation
- Location: Creative Briefs folder
- File ID: \`${file.id}\`
- Open: https://docs.google.com/presentation/d/${file.id}/edit

Use \`update_concept_slides\` with presentation_id \`${file.id}\` to populate it with concept content.`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error creating concept brief: ${err.message}`,
          },
        ],
      };
    }
  }
);

// ── Tool 10: Create Video Script ─────────────────────────────────────

server.tool(
  "create_video_script",
  `Create a new video script outline (Google Sheets) for a video ad concept.
Places it in the specified folder with standard naming convention.
The sheet can then be populated with script sections, timing, and dialogue.`,
  {
    client_name: z.string().describe("Client brand name"),
    concept_code: z
      .string()
      .describe("Concept code (e.g. 'K143')"),
    concept_name: z
      .string()
      .describe("Concept name"),
    folder_id: z
      .string()
      .describe("Folder ID to create the script in"),
    template_file_id: z
      .string()
      .optional()
      .describe(
        "Optional: ID of an existing script sheet to copy as template"
      ),
    script_content: z
      .string()
      .optional()
      .describe(
        "Optional: Script content to pre-populate (will be inserted as a Google Doc instead if provided)"
      ),
  },
  async ({
    client_name,
    concept_code,
    concept_name,
    folder_id,
    template_file_id,
    script_content,
  }) => {
    const drive = getGoogleDriveService();
    const fileName = `${concept_code} - ${concept_name} - Video Script`;

    try {
      let file;
      if (template_file_id) {
        file = await drive.copyFile(
          template_file_id,
          fileName,
          folder_id
        );
      } else if (script_content) {
        // Create as a Google Doc with content pre-populated
        file = await drive.createGoogleDoc(
          fileName,
          folder_id,
          script_content
        );
      } else {
        file = await drive.createGoogleSheet(fileName, folder_id);
      }

      const fileType =
        file.mimeType === "application/vnd.google-apps.spreadsheet"
          ? "Google Sheet"
          : "Google Doc";
      const editUrl =
        file.mimeType === "application/vnd.google-apps.spreadsheet"
          ? `https://docs.google.com/spreadsheets/d/${file.id}/edit`
          : `https://docs.google.com/document/d/${file.id}/edit`;

      return {
        content: [
          {
            type: "text" as const,
            text: `## Video Script Created

**${fileName}**
- Type: ${fileType}
- File ID: \`${file.id}\`
- Open: ${editUrl}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error creating video script: ${err.message}`,
          },
        ],
      };
    }
  }
);

// ── Tool 11: Get Document Content ────────────────────────────────────

server.tool(
  "get_drive_file_content",
  `Read the content of a file in Google Drive. Supports Google Docs (as text), Google Sheets (as CSV),
and other text-based files. Use this to read template outlines, messaging docs, or any Drive file.`,
  {
    file_id: z.string().describe("Google Drive file ID"),
  },
  async ({ file_id }) => {
    const drive = getGoogleDriveService();

    try {
      const metadata = await drive.getFileMetadata(file_id);
      const content = await drive.getDocumentContent(file_id);

      return {
        content: [
          {
            type: "text" as const,
            text: `## ${metadata.name}\n\nType: ${getMimeLabel(metadata.mimeType)}\nFile ID: \`${file_id}\`\n\n---\n\n${content}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error reading file: ${err.message}`,
          },
        ],
      };
    }
  }
);

// ── Tool 12: Analyze Video ────────────────────────────────────────────

server.tool(
  "analyze_video",
  `Analyze a single video file (MP4/MOV) for creative strategy insights.
Extracts key frames via ffmpeg, sends them to GPT-4o Vision for visual analysis, and transcribes audio via Whisper.
Returns a structured breakdown: metadata, frame-by-frame scene analysis, transcript, and narrative structure.

Example: analyze_video with file_path "/path/to/vsl-ad1.mp4"`,
  {
    file_path: z
      .string()
      .describe("Absolute path to the video file (.mp4, .mov)"),
    frame_detail: z
      .enum(["low", "high"])
      .default("low")
      .describe(
        "Vision API detail level: 'low' (~$0.002/video) or 'high' (~$0.05/video)"
      ),
    include_transcript: z
      .boolean()
      .default(true)
      .describe("Whether to transcribe audio via Whisper"),
  },
  async ({ file_path, frame_detail, include_transcript }) => {
    const analyzer = getVideoAnalyzerService();

    try {
      const result = await analyzer.analyzeVideo(file_path);

      const frameLines = result.frameAnalyses
        .map(
          (f) =>
            `| ${f.timestampSeconds.toFixed(1)}s | ${f.sceneType} | ${f.description} | ${f.onScreenText.join("; ") || "—"} |`
        )
        .join("\n");

      const sceneBreakdown = Object.entries(
        result.narrativeStructure.sceneBreakdown
      )
        .map(([type, count]) => `- ${type}: ${count}`)
        .join("\n");

      const output = `## Video Analysis: ${result.metadata.fileName}

**Type:** ${result.metadata.videoType} | **Duration:** ${result.metadata.durationSeconds}s | **Resolution:** ${result.metadata.width}x${result.metadata.height}
**Folder:** ${result.metadata.folderContext}
**Frames analyzed:** ${result.frameAnalyses.length}

### Frame-by-Frame Breakdown

| Time | Scene Type | Description | On-Screen Text |
|------|-----------|-------------|----------------|
${frameLines}

### Narrative Structure

**Hook:** ${result.narrativeStructure.hookTimestamp !== null ? result.narrativeStructure.hookTimestamp + "s" : "Not detected"}
**Body:** ${result.narrativeStructure.bodyTimestamp !== null ? result.narrativeStructure.bodyTimestamp + "s" : "Not detected"}
**CTA:** ${result.narrativeStructure.ctaTimestamp !== null ? result.narrativeStructure.ctaTimestamp + "s" : "Not detected"}

**Scene Breakdown:**
${sceneBreakdown}

### Transcript

${result.transcript}`;

      return {
        content: [{ type: "text" as const, text: output }],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error analyzing video: ${err.message}`,
          },
        ],
      };
    }
  }
);

// ── Tool 13: Analyze Video Batch ──────────────────────────────────────

server.tool(
  "analyze_video_batch",
  `Analyze all video files in a folder (recursively) for creative strategy.
Processes each video: extracts frames, runs GPT-4o Vision analysis, transcribes audio via Whisper.
Then synthesizes all results into creative strategy rows matching the 15-column agency Excel format.
Saves intermediate results for crash recovery at /tmp/video-analysis/.

Example: analyze_video_batch with folder_path "/path/to/Akka" brand_context "Akka gut health supplements"`,
  {
    folder_path: z
      .string()
      .describe("Absolute path to folder containing videos"),
    brand_context: z
      .string()
      .optional()
      .describe(
        "Brand/product context for creative analysis (e.g., 'Akka — liver and gut health supplement brand targeting women 30-50+')"
      ),
    resume_from: z
      .string()
      .optional()
      .describe(
        "Path to intermediate results JSON to resume a previous batch (e.g., /tmp/video-analysis/batch_Akka.json)"
      ),
    frame_detail: z
      .enum(["low", "high"])
      .default("low")
      .describe("Vision API detail level"),
  },
  async ({ folder_path, brand_context, resume_from, frame_detail }) => {
    const analyzer = getVideoAnalyzerService();

    try {
      const result = await analyzer.analyzeBatch(folder_path, {
        brandContext: brand_context,
        resumeFrom: resume_from,
        frameDetail: frame_detail,
      });

      const angleList = result.creativeStrategy
        .map(
          (row, i) =>
            `${i + 1}. **${row.angle}** (${row.namingConvention}) — Priority ${row.priority}\n   ${row.description.slice(0, 200)}${row.description.length > 200 ? "..." : ""}`
        )
        .join("\n\n");

      const output = `## Batch Analysis Complete

**Videos processed:** ${result.stats.successCount}/${result.stats.totalVideos}
**Errors:** ${result.stats.errorCount}
**Total frames analyzed:** ${result.stats.totalFramesAnalyzed}
**Estimated API cost:** $${result.stats.estimatedCost.toFixed(2)}
**Processing time:** ${(result.stats.processingTimeMs / 1000 / 60).toFixed(1)} minutes

### Creative Strategy Angles Found: ${result.creativeStrategy.length}

${angleList}

### Next Steps

Use \`export_creative_strategy\` to export the full 15-column data as JSON or CSV.
Intermediate results saved at: \`/tmp/video-analysis/batch_${folder_path.split("/").pop()?.replace(/\s+/g, "_")}.json\``;

      return {
        content: [{ type: "text" as const, text: output }],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error in batch analysis: ${err.message}`,
          },
        ],
      };
    }
  }
);

// ── Tool 14: Export Creative Strategy ─────────────────────────────────

server.tool(
  "export_creative_strategy",
  `Export video analysis results as structured JSON or CSV matching the 15-column creative strategy Excel format.
Reads from a saved batch analysis file and writes the formatted output.
The JSON output can be directly converted to Excel. Each row = one creative angle with all 15 fields.

Example: export_creative_strategy with analysis_json_path "/tmp/video-analysis/batch_Akka.json" output_path "/tmp/akka-strategy.json"`,
  {
    analysis_json_path: z
      .string()
      .describe(
        "Path to a saved batch analysis JSON file (from analyze_video_batch)"
      ),
    output_path: z
      .string()
      .describe("Where to save the export (e.g., '/tmp/akka-strategy.json')"),
    format: z
      .enum(["json", "csv"])
      .default("json")
      .describe("Export format: 'json' for structured data, 'csv' for spreadsheet import"),
  },
  async ({ analysis_json_path, output_path, format }) => {
    try {
      const raw = await import("node:fs").then((fs) =>
        fs.promises.readFile(analysis_json_path, "utf-8")
      );
      const data = JSON.parse(raw);
      const rows = data.creativeStrategy || [];

      if (rows.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No creative strategy rows found in the analysis file. Run analyze_video_batch first.",
            },
          ],
        };
      }

      let output: string;
      if (format === "csv") {
        const headers = [
          "Naming Convention",
          "Priority",
          "Persona",
          "Angle",
          "Sub-Angles",
          "Primary Benefits",
          "Description",
          "Emotional Fear",
          "Problem>Solution>Promise",
          "Before / After Frameworks",
          "Example Headline",
          "Example Testimonial",
          "Example UGC Hook",
          "Key Points / Framing",
          "Objections",
        ];
        const csvRows = rows.map((r: any) =>
          [
            r.namingConvention,
            r.priority,
            r.persona,
            r.angle,
            r.subAngles,
            r.primaryBenefits,
            r.description,
            r.emotionalFear,
            r.problemSolutionPromise,
            r.beforeAfterFrameworks,
            r.exampleHeadline,
            r.exampleTestimonial,
            r.exampleUGCHook,
            r.keyPointsFraming,
            r.objections,
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
        );
        output = [headers.join(","), ...csvRows].join("\n");
      } else {
        output = JSON.stringify(rows, null, 2);
      }

      const fs = await import("node:fs");
      await fs.promises.writeFile(output_path, output);

      return {
        content: [
          {
            type: "text" as const,
            text: `## Creative Strategy Exported

**Format:** ${format.toUpperCase()}
**Rows:** ${rows.length} angles
**Saved to:** \`${output_path}\`

**Columns:** Naming Convention, Priority, Persona, Angle, Sub-Angles, Primary Benefits, Description, Emotional Fear, Problem>Solution>Promise, Before/After Frameworks, Example Headline, Example Testimonial, Example UGC Hook, Key Points/Framing, Objections`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error exporting: ${err.message}`,
          },
        ],
      };
    }
  }
);

// ── Tool 15: pull_selects ────────────────────────────────────────────

server.tool(
  "pull_selects",
  `Identify the best clips/moments from analyzed video footage with scored in/out points.
Uses existing batch analysis data (no re-analysis needed). Each select is scored 0-100.
Returns clips organized by scene type (hooks, CTAs, testimonials, product shots, b-roll).`,
  {
    analysis_json_path: z
      .string()
      .describe("Path to batch analysis JSON file (from analyze_video_batch)"),
    scene_types: z
      .array(
        z.enum([
          "hook",
          "body",
          "cta",
          "b-roll",
          "transition",
          "testimonial",
          "product_shot",
        ])
      )
      .optional()
      .describe("Filter to specific scene types (default: all)"),
    min_score: z
      .number()
      .min(0)
      .max(100)
      .default(30)
      .describe("Minimum quality score (0-100)"),
    top_n_per_type: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Return top N selects per scene type"),
    min_duration: z
      .number()
      .default(1.0)
      .describe("Minimum clip duration in seconds"),
    base_path: z
      .string()
      .optional()
      .describe("Base path to prepend to relative video file paths"),
  },
  async ({
    analysis_json_path,
    scene_types,
    min_score,
    top_n_per_type,
    min_duration,
    base_path,
  }) => {
    try {
      const fs = await import("node:fs");
      const raw = fs.readFileSync(analysis_json_path, "utf-8");
      const batch = JSON.parse(raw);
      const analyses = batch.videoAnalyses || batch;

      const service = new PremiereXmlGeneratorService();
      const selects = service.pullSelects(analyses, {
        sceneTypes: scene_types as any,
        minScore: min_score,
        topN: top_n_per_type,
        minDurationSeconds: min_duration,
        basePath: base_path,
      });

      // Group by scene type for display
      const byType = new Map<string, typeof selects>();
      for (const s of selects) {
        const arr = byType.get(s.sceneType) || [];
        arr.push(s);
        byType.set(s.sceneType, arr);
      }

      let output = `## Selects Pulled: ${selects.length} clips\n\n`;
      for (const [type, clips] of byType) {
        output += `### ${type.toUpperCase()} (${clips.length} clips)\n\n`;
        output += `| Score | File | In | Out | Duration | Description |\n`;
        output += `|-------|------|----|-----|----------|-------------|\n`;
        for (const c of clips.slice(0, 15)) {
          output += `| ${c.score} | ${c.sourceFileName} | ${c.timeRange.inSeconds}s | ${c.timeRange.outSeconds}s | ${c.durationSeconds}s | ${c.description.slice(0, 60)} |\n`;
        }
        output += `\n`;
      }

      return { content: [{ type: "text" as const, text: output }] };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
      };
    }
  }
);

// ── Tool 16: build_premiere_bins ─────────────────────────────────────

server.tool(
  "build_premiere_bins",
  `Auto-organize video selects into categorized bins (Hooks, B-Roll, Testimonials, CTAs, Product Shots).
Creates a bin structure ready for Premiere Pro import. Run on existing batch analysis data.`,
  {
    analysis_json_path: z
      .string()
      .describe("Path to batch analysis JSON file"),
    min_score: z.number().default(30).describe("Minimum score for selects"),
    base_path: z
      .string()
      .optional()
      .describe("Base path for resolving relative video paths"),
  },
  async ({ analysis_json_path, min_score, base_path }) => {
    try {
      const fs = await import("node:fs");
      const raw = fs.readFileSync(analysis_json_path, "utf-8");
      const batch = JSON.parse(raw);
      const analyses = batch.videoAnalyses || batch;

      const service = new PremiereXmlGeneratorService();
      const selects = service.pullSelects(analyses, {
        minScore: min_score,
        basePath: base_path,
      });
      const bins = service.buildBins(selects);

      let output = `## Premiere Bins: ${bins.length} categories\n\n`;
      for (const bin of bins) {
        output += `### ${bin.name} (${bin.selects.length} clips)\n`;
        const top3 = bin.selects.slice(0, 3);
        for (const s of top3) {
          output += `  - [Score ${s.score}] ${s.sourceFileName} (${s.timeRange.inSeconds}s-${s.timeRange.outSeconds}s) — ${s.description.slice(0, 80)}\n`;
        }
        if (bin.selects.length > 3) {
          output += `  - ... and ${bin.selects.length - 3} more\n`;
        }
        output += `\n`;
      }

      output += `**Total selects across all bins:** ${selects.length}\n`;

      return { content: [{ type: "text" as const, text: output }] };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
      };
    }
  }
);

// ── Tool 17: assemble_rough_cut ──────────────────────────────────────

server.tool(
  "assemble_rough_cut",
  `Generate a rough cut edit sequence by assembling the best selects following a narrative template.
Templates: "Standard Performance Ad (30s)", "Quick Hook Ad (15s)", "Testimonial-Led Ad (45s)".
Places clips on a timeline: hook → problem → solution → testimonial → CTA.`,
  {
    analysis_json_path: z
      .string()
      .describe("Path to batch analysis JSON file"),
    template_name: z
      .enum([
        "Standard Performance Ad (30s)",
        "Quick Hook Ad (15s)",
        "Testimonial-Led Ad (45s)",
      ])
      .default("Standard Performance Ad (30s)")
      .describe("Narrative template to follow"),
    fps: z.number().default(30).describe("Frames per second"),
    min_score: z.number().default(30).describe("Minimum score for selects"),
    base_path: z
      .string()
      .optional()
      .describe("Base path for resolving relative video paths"),
  },
  async ({ analysis_json_path, template_name, fps, min_score, base_path }) => {
    try {
      const fs = await import("node:fs");
      const raw = fs.readFileSync(analysis_json_path, "utf-8");
      const batch = JSON.parse(raw);
      const analyses = batch.videoAnalyses || batch;

      const service = new PremiereXmlGeneratorService();
      const selects = service.pullSelects(analyses, {
        minScore: min_score,
        basePath: base_path,
      });
      const bins = service.buildBins(selects);
      const template = service
        .getTemplates()
        .find((t) => t.name === template_name)!;
      const roughCut = service.assembleRoughCut(bins, template, { fps });

      let output = `## Rough Cut: ${roughCut.name}\n\n`;
      output += `**Duration:** ${roughCut.totalDurationSeconds}s | **FPS:** ${fps} | **Clips:** ${roughCut.clips.length}\n\n`;
      output += `| # | Timeline | Duration | Scene Type | Source File | Score | Description |\n`;
      output += `|---|----------|----------|------------|-------------|-------|-------------|\n`;

      for (let i = 0; i < roughCut.clips.length; i++) {
        const c = roughCut.clips[i];
        const dur = Math.round(
          (c.timelineOutSeconds - c.timelineInSeconds) * 10
        ) / 10;
        output += `| ${i + 1} | ${c.timelineInSeconds}s-${c.timelineOutSeconds}s | ${dur}s | ${c.select.sceneType} | ${c.select.sourceFileName} | ${c.select.score} | ${c.select.description.slice(0, 50)} |\n`;
      }

      output += `\n**Template segments:** ${template.segments.map((s) => s.name).join(" → ")}\n`;

      return { content: [{ type: "text" as const, text: output }] };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
      };
    }
  }
);

// ── Tool 18: export_premiere_xml ─────────────────────────────────────

server.tool(
  "export_premiere_xml",
  `Export a complete Premiere Pro-ready project as FCP 7 XML (XMEML format).
Generates organized bins AND a rough cut sequence. Import directly via Premiere Pro File > Import.
Combines pull_selects + build_bins + assemble_rough_cut + XMEML generation in one step.`,
  {
    analysis_json_path: z
      .string()
      .describe("Path to batch analysis JSON file"),
    output_path: z
      .string()
      .describe("Where to save the .xml file"),
    project_name: z
      .string()
      .default("AI Rough Cut")
      .describe("Project name shown in Premiere Pro"),
    template_name: z
      .enum([
        "Standard Performance Ad (30s)",
        "Quick Hook Ad (15s)",
        "Testimonial-Led Ad (45s)",
      ])
      .default("Standard Performance Ad (30s)")
      .describe("Narrative template for rough cut sequence"),
    fps: z.number().default(30).describe("Frames per second"),
    resolution_width: z.number().default(1080).describe("Output width"),
    resolution_height: z
      .number()
      .default(1920)
      .describe("Output height (1920 for 9:16 vertical)"),
    min_score: z.number().default(30).describe("Minimum quality score"),
    base_path: z
      .string()
      .optional()
      .describe("Base path to prepend to relative video paths for file:/// URLs"),
  },
  async ({
    analysis_json_path,
    output_path,
    project_name,
    template_name,
    fps,
    resolution_width,
    resolution_height,
    min_score,
    base_path,
  }) => {
    try {
      const service = new PremiereXmlGeneratorService();
      const exportData = await service.generatePremiereProject(
        analysis_json_path,
        output_path,
        {
          projectName: project_name,
          templateName: template_name,
          fps,
          resolution: { width: resolution_width, height: resolution_height },
          minScore: min_score,
          basePath: base_path,
        }
      );

      let output = `## Premiere Pro XML Exported\n\n`;
      output += `**File:** \`${output_path}\`\n`;
      output += `**Project:** ${project_name}\n`;
      output += `**FPS:** ${fps} | **Resolution:** ${resolution_width}x${resolution_height}\n\n`;
      output += `### Bins\n`;
      for (const bin of exportData.bins) {
        output += `- **${bin.name}:** ${bin.selects.length} clips\n`;
      }
      output += `\n### Sequences\n`;
      for (const seq of exportData.sequences) {
        output += `- **${seq.name}:** ${seq.totalDurationSeconds}s, ${seq.clips.length} clips\n`;
      }
      output += `\n**Total selects:** ${exportData.allSelects.length}\n`;
      output += `\n**Import in Premiere Pro:** File > Import > select \`${output_path}\`\n`;

      return { content: [{ type: "text" as const, text: output }] };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
      };
    }
  }
);

// ── Helpers ──────────────────────────────────────────────────────────

function getMimeLabel(mimeType: string): string {
  const labels: Record<string, string> = {
    "application/vnd.google-apps.folder": "📁 Folder",
    "application/vnd.google-apps.document": "📄 Google Doc",
    "application/vnd.google-apps.spreadsheet": "📊 Google Sheet",
    "application/vnd.google-apps.presentation": "📑 Google Slides",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "📑 PowerPoint",
    "application/pdf": "📕 PDF",
    "image/png": "🖼 PNG",
    "image/jpeg": "🖼 JPEG",
    "video/mp4": "🎬 Video",
  };
  return labels[mimeType] || `📎 ${mimeType.split("/").pop()}`;
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
