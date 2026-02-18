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
        "GOOGLE_REFRESH_TOKEN": "your_token"
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
- **Google Cloud Speech-to-Text API** must be enabled for audio transcription (optional — analysis works without it)

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
