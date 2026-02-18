# Facebook Ad Strategy Agent

This is an MCP server that supports a creative strategist workflow for building Facebook performance marketing ad concepts.

## Setup

1. Copy `.env.example` to `.env` and fill in your API credentials
2. Run `npm install && npm run build`
3. Add this server to your Claude MCP config (see below)

### MCP Configuration

Add to your Claude settings (`~/.claude/settings.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "fb-ad-strategy": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/path/to/thedojo",
      "env": {
        "META_ACCESS_TOKEN": "your_token",
        "GOOGLE_CLIENT_ID": "your_id",
        "GOOGLE_CLIENT_SECRET": "your_secret",
        "GOOGLE_REFRESH_TOKEN": "your_token",
        "OPENAI_API_KEY": "your_key",
        "GOOGLE_AI_STUDIO_API_KEY": "your_key"
      }
    }
  }
}
```

## Creative Strategist Workflow

When working on a new Facebook ad concept, follow this workflow:

### Step 1: Find Reference Ads
Use `search_reference_ads` to find active ads from competitor brands or brands in the same category.
Example: "Search for reference ads from Glossier and Summer Fridays for skincare"

### Step 2: Pull the Messaging Document
Use `get_messaging_doc` to retrieve the client's creative messaging document from Google Drive.
This contains approved angles, hooks, brand voice guidelines, and value propositions.

### Step 3: Recommend Angles
Use `recommend_angles` with the reference ad details and messaging angles from the document.
This analyzes which angles from the client's messaging framework best align with what's working
in the reference ad.

### Step 4: Write Ad Copy
Use `write_ad_copy` with the chosen angle, reference ad, and brand voice to generate
multiple copy variations (headline, primary text, description, CTA).

### Step 5: Update Concept Slides
Use `update_concept_slides` to push the finalized concept into a Google Slides presentation.
Supports both template-based population (placeholder replacement) and new slide creation.

### Helper: List Slides
Use `list_slides` to see all slides in a presentation before updating.

## Video Ad Analysis Workflow (Agentic)

For video ad creative teardowns with iterative concept refinement:

### Step 1: Ingest Video
Use `ingest_video` to load a video from a URL, Google Drive, or local file.
Returns a `video_id` and metadata (duration, resolution, codec, audio track).

### Step 2: Analyze Video
Use `analyze_video` with the `video_id`. This extracts key frames at scene boundaries
(returned as images), detects scene structure/pacing, and transcribes audio.
Claude then performs a full creative teardown covering hook analysis, visual arc,
pacing, text overlays, product presentation, CTA, audience signals, and emotional triggers.

### Step 3: Propose Concept
Use `propose_video_concept` with the `video_id`, brand context, messaging angles,
and Claude's video analysis summary. Creates a refinement session and returns a structured
brief for Claude to generate a concept proposal (video structure, hook strategy, ad copy, visual direction).

### Step 4: Iterative Refinement
Use `refine_concept` with the session ID, Claude's previous proposal, and user feedback.
The tool tracks all iterations so Claude can see the full evolution of the concept and
produce informed refinements. Repeat until the concept is approved.

### Step 5: Finalize
Once approved, use `write_ad_copy` for final copy and `update_concept_slides` to push
the concept into the deck.

### Helper: Concept History
Use `get_concept_history` to view all iterations for a session or list active sessions.

### Requirements
- **ffmpeg** must be installed for video processing (`brew install ffmpeg` or `apt install ffmpeg`)
- **OPENAI_API_KEY** must be set for Whisper audio transcription (optional — video analysis works without it)

## AI Creative Generation Workflow

For generating ad creative assets (images and video) using Google AI Studio:

### Generate Ad Images (Nano Banana Pro)
Use `generate_ad_image` to create ad creative images — product shots, lifestyle imagery,
text overlay compositions, and ad mockups.

**Designer Prompt Workflow** (follow this process when generating images):

1. **Gather Inspiration:** Ask for reference ad inspiration — competitor ads, Pinterest boards,
   or use `search_reference_ads` / `analyze_image_ad` output. If they have a reference image,
   pass it as `reference_image_base64` for style-matching.
2. **Describe the Vision:** Describe (or have Claude Opus 4.6 describe) the reference image in detail —
   subject, environment, composition, colors, textures, mood, and story.
3. **Art Direct the Shot:** Layer in structured art direction parameters:
   - **Camera Angle:** top_down_90, birds_eye_65, high_angle_45, above_30, slightly_above_15,
     straight_on_0, hero_view_neg15, low_view_neg45, worms_eye_neg75
   - **Shot Type:** establishing, wide, medium, close_up, extreme_close_up, cut_away, two_shot,
     over_the_shoulder, point_of_view, perspective
   - **Lens:** 24mm_wide, 35mm_standard_wide, 50mm_standard, 85mm_portrait, 100mm_macro,
     135mm_telephoto, 200mm_compressed
   - **Lighting:** golden_hour, soft_natural, studio_softbox, hard_direct, backlit_rim,
     flat_lay_even, dramatic_chiaroscuro, neon_colored, overcast_diffused
   - **Art Direction Notes:** free-form (color palette, textures, props, styling, mood)
4. **Refine for Nano Banana Pro:** Use Claude (Opus 4.6) to refine and optimize the prompt —
   be specific, use photographic language, avoid vague terms. The tool auto-appends quality anchors.
5. **Iterate:** Generate at 1K for fast drafts. Review, adjust, regenerate. Lock winners at 2K/4K.

Example: "Generate a hero product shot of a moisturizer on marble, hero_view camera angle,
85mm portrait lens, golden hour lighting, art direction: warm earth tones, dewy texture finish,
scattered botanicals as props, 4:5 aspect ratio for Instagram feed"

### Generate Ad Videos (Veo 3.1)
Use `generate_ad_video` to create short video clips — product demos, B-roll, UGC-style content,
hook visuals, and unboxing sequences. Includes native audio generation (dialogue, ambient sounds, music).

Example: "Generate a 9:16 vertical video of hands unboxing a skincare set, ASMR-style audio, clean white background"

Two model variants:
- **Standard** (`veo-3.1-generate-preview`): Highest quality, best for final assets
- **Fast** (`veo-3.1-fast-generate-preview`): 2x faster, ~1/5 cost, best for drafts and iteration

### End-to-End Creative Generation Flow
1. **Reference & Inspiration:** Find reference ads with `search_reference_ads`, tear them down with
   `analyze_image_ad` / `analyze_video`. Ask the designer for any additional visual inspiration
   (Pinterest, Google Images, competitor ads). Pass reference images directly into `generate_ad_image`.
2. **Describe & Art Direct:** Use Claude (Opus 4.6) to describe the reference in photographic detail,
   then layer in camera angle, shot type, lens, lighting, and art direction notes.
3. **Write Ad Copy:** Generate copy variations with `write_ad_copy`.
4. **Generate Image Drafts:** Use `generate_ad_image` at 1K resolution for rapid iteration.
   Refine the prompt, adjust art direction params, and regenerate until the concept is locked.
5. **Generate Video Clips:** Use `generate_ad_video` with `fast` model for draft iterations.
6. **Finalize:** Regenerate approved concepts at 2K/4K (images) or standard model (video).
7. **Publish:** Push finalized concepts to Google Slides with `update_concept_slides`.

### Requirements
- **GOOGLE_AI_STUDIO_API_KEY** must be set (get from [aistudio.google.com](https://aistudio.google.com))
- Billing must be enabled on the Google AI Studio account (no free tier for API access)

## Available Tools

| Tool | Purpose |
|------|---------|
| `search_reference_ads` | Search Meta Ad Library for reference ads |
| `get_messaging_doc` | Retrieve messaging docs from Google Drive |
| `recommend_angles` | Analyze reference ad and recommend angles |
| `write_ad_copy` | Generate ad copy variations |
| `update_concept_slides` | Update Google Slides with concept |
| `list_slides` | List slides in a presentation |
| `ingest_video` | Ingest video from URL, Google Drive, or local path |
| `analyze_video` | Extract frames, detect scenes, transcribe audio |
| `propose_video_concept` | Start iterative concept refinement from video analysis |
| `refine_concept` | Iterate on a concept with feedback |
| `get_concept_history` | View iteration history for a concept session |
| `generate_ad_image` | Generate ad images with Nano Banana Pro (Gemini 3 Pro Image) |
| `generate_ad_video` | Generate ad video clips with Veo 3.1 |
