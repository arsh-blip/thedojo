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

### Step 1: Gather Reference Ads
User provides reference ads manually (URLs, pasted copy, screenshots, transcripts, or competitor analysis files).
`search_reference_ads` is available as an optional tool if the Meta Ad Library API is configured.
Example: "Here's a competitor ad I want to riff on: [paste ad copy or share URL]"

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

### Step 6: Browse & Navigate Drive
Use `browse_drive` to navigate the client folder structure in Google Drive.
The folder hierarchy is: Clients → [Client Name] → Creative Briefs / Creative Exports.
Default root folder: `1ttQlzxwqEqvt3keHwKAcXn33TnkT5bos`

### Step 7: Set Up Client Folders
Use `setup_client_folder` to create the standard folder structure for a new client
(client folder + Creative Briefs + Creative Exports subfolders).

### Step 8: Create Concept Brief
Use `create_concept_brief` to create a new Google Slides presentation in a client's
Creative Briefs folder. Follows standard naming: [Code] - [Name] - [Type] - [Status].
Can copy from an existing template or create blank.

### Step 9: Create Video Script
Use `create_video_script` to create a new video script outline (Google Sheet or Doc)
for video ad concepts. Can copy from template or create with pre-populated content.

### Helper: Read Drive File
Use `get_drive_file_content` to read any file's content from Google Drive
(Google Docs as text, Sheets as CSV, etc.).

## Available Tools

| Tool | Purpose |
|------|---------|
| `search_reference_ads` | Search Meta Ad Library for reference ads (optional — user provides ads manually) |
| `get_messaging_doc` | Retrieve messaging docs from Google Drive |
| `recommend_angles` | Analyze reference ad and recommend angles |
| `write_ad_copy` | Generate ad copy variations |
| `update_concept_slides` | Update Google Slides with concept |
| `list_slides` | List slides in a presentation |
| `browse_drive` | Navigate client folder structure in Google Drive |
| `setup_client_folder` | Create standard folder structure for a client |
| `create_concept_brief` | Create new concept brief (Google Slides) |
| `create_video_script` | Create video script outline (Sheet/Doc) |
| `get_drive_file_content` | Read any file's content from Google Drive |
| `analyze_video` | Analyze a single video ad (frames + transcript + narrative structure) |
| `analyze_video_batch` | Batch-analyze a folder of videos and synthesize creative strategy |
| `export_creative_strategy` | Export analysis results as JSON/CSV (15-column format) |
| `pull_selects` | Identify best clips from analyzed footage with scored in/out points |
| `build_premiere_bins` | Auto-organize clips into categorized bins (Hooks, B-Roll, etc.) |
| `assemble_rough_cut` | Generate rough cut sequence following a narrative template |
| `export_premiere_xml` | Export Premiere Pro-ready FCP 7 XML with bins + rough cut |

## Client Folder Structure

```
Clients/ (root: 1ttQlzxwqEqvt3keHwKAcXn33TnkT5bos)
├── ULTRA/
│   ├── Messaging Doc
│   ├── Acquisition/
│   │   ├── ULTRA Creative Briefs/  (concept slides)
│   │   └── ULTRA / Dojo Creative Exports/
│   └── ...
├── Reliant Pet/
│   ├── Creative Briefs/  (1R7lHOwGdNYPFeaTK7KdzcE56jNKg3ozK)
│   └── Creative Exports/ (1qrIZBlTFKTT40JlUfsD7KTfrTDoKwaIr)
├── Magna/
├── Feel Goods/
├── Anomaly/
└── ... (12 clients total)
```

Concept file naming convention: `[Code] - [Name] - [Type: Static/Video] - [Status: New/Iteration]`
