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
        "OPENAI_API_KEY": "your_openai_key"
      }
    }
  }
}
```

### System Requirements

- **ffmpeg** and **ffprobe** must be installed for video ad analysis (`analyze_video_ads`, `transcribe_video`)

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

## Video Ad Analysis Workflow

For brands with existing winning video ads, use this workflow to catalog and analyze them
before building new concepts.

### Quick: Transcribe a Single Video
Use `transcribe_video` with a file path to get just the transcript from one video — no frames,
metadata, or cataloging. Great for a quick look at what a video says before deciding whether
to run the full analysis.

Example: "Transcribe the video at /path/to/ad-video.mp4"

### Step 1: Analyze Video Ads
Use `analyze_video_ads` with the folder path containing your video files and the brand name.
This extracts key frames, metadata (duration, aspect ratio, resolution), and transcribes
the audio from every video using OpenAI Whisper.

Set `analyze_visuals: true` to also run GPT-4o vision on each frame. This detects:
- **Text overlays / burned-in captions** on each frame
- **Scene types** (product_shot, lifestyle, ugc_talking_head, text_card, etc.)
- **Caption-free segments** — contiguous time ranges with no text overlays, ideal for clipping

Example: "Analyze all the video ads in /path/to/brand-videos for Glossier with visual analysis enabled"

### Step 2: Query the Catalog
Use `query_ad_catalog` to search the analyzed catalog by transcript content, duration,
aspect ratio, or filename. Use this to find patterns across winning ads.

With visual analysis, you can also filter by:
- `has_captions: false` — find videos with no burned-in text
- `caption_free_only: true` — find videos with clean clip-ready segments
- `scene_type` — filter by visual scene type

Example: "Find all 9:16 ads under 30 seconds that mention 'free shipping'"
Example: "Find caption-free clips I can repurpose without text overlays"

### Step 3: Use Insights in Creative Strategy
Feed the transcripts and patterns from winning ads into `recommend_angles` and `write_ad_copy`
to create new concepts grounded in what's already proven to work.

## Available Tools

| Tool | Purpose |
|------|---------|
| `search_reference_ads` | Search Meta Ad Library for reference ads |
| `get_messaging_doc` | Retrieve messaging docs from Google Drive |
| `recommend_angles` | Analyze reference ad and recommend angles |
| `write_ad_copy` | Generate ad copy variations |
| `update_concept_slides` | Update Google Slides with concept |
| `list_slides` | List slides in a presentation |
| `transcribe_video` | Transcribe audio from a single video file using Whisper |
| `analyze_video_ads` | Bulk-analyze a folder of video ads (frames, metadata, transcripts) |
| `query_ad_catalog` | Search and filter the analyzed video ad catalog |
