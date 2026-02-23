import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import type {
  FrameAnalysis,
  VideoAnalysisResult,
  SceneType,
  TimeRange,
  Select,
  Bin,
  TimelineClip,
  NarrativeTemplate,
  NarrativeSegment,
  RoughCut,
  PremiereExport,
  PullSelectsOptions,
  AssemblyOptions,
  FullPipelineOptions,
} from "../types.js";

const execFileAsync = promisify(execFile);
const FFMPEG_PATH = "/tmp/ffmpeg";

const BIN_DEFINITIONS: { name: string; sceneType: SceneType; color: string }[] = [
  { name: "Hooks", sceneType: "hook", color: "Mango" },
  { name: "Body", sceneType: "body", color: "Forest" },
  { name: "B-Roll", sceneType: "b-roll", color: "Iris" },
  { name: "Testimonials", sceneType: "testimonial", color: "Rose" },
  { name: "Product Shots", sceneType: "product_shot", color: "Lavender" },
  { name: "CTAs", sceneType: "cta", color: "Caribbean" },
  { name: "Transitions", sceneType: "transition", color: "Cerulean" },
];

const SCENE_TYPE_BONUS: Record<string, number> = {
  hook: 20,
  cta: 15,
  testimonial: 15,
  product_shot: 10,
  "b-roll": 5,
  body: 0,
  transition: -5,
};

export class PremiereXmlGeneratorService {
  private idCounter = 0;

  // ── Core Public Methods ──────────────────────────────────────────

  pullSelects(
    analyses: VideoAnalysisResult[],
    options: PullSelectsOptions = {}
  ): Select[] {
    const {
      sceneTypes,
      minDurationSeconds = 1.0,
      maxDurationSeconds = 30.0,
      minScore = 0,
      topN,
      basePath,
    } = options;

    const allSelects: Select[] = [];

    for (const analysis of analyses) {
      const { metadata, frameAnalyses, transcript } = analysis;
      if (frameAnalyses.length === 0) continue;

      const sorted = [...frameAnalyses].sort(
        (a, b) => a.timestampSeconds - b.timestampSeconds
      );

      // Compute time ranges for each frame
      const rawSelects: Select[] = [];
      for (let i = 0; i < sorted.length; i++) {
        const frame = sorted[i];
        const timeRange = this.computeTimeRange(
          frame,
          sorted,
          i,
          metadata.durationSeconds
        );
        const duration = timeRange.outSeconds - timeRange.inSeconds;

        if (duration < 0.1) continue;

        const videoPath = basePath
          ? path.resolve(basePath, metadata.filePath)
          : metadata.filePath;

        const { score, rationale } = this.scoreSelect(
          frame,
          sorted,
          metadata,
          transcript,
          timeRange
        );

        const transcriptPortion = this.extractTranscriptForRange(
          transcript,
          timeRange,
          metadata.durationSeconds
        );

        rawSelects.push({
          id: this.generateId("sel"),
          sourceVideoPath: videoPath,
          sourceFileName: metadata.fileName,
          timeRange,
          durationSeconds: Math.round(duration * 10) / 10,
          sceneType: frame.sceneType,
          score,
          scoreRationale: rationale,
          description: frame.description,
          transcript: transcriptPortion,
          onScreenText: frame.onScreenText,
          people: frame.people,
          products: frame.products,
          tags: this.generateTags(frame, metadata),
        });
      }

      // Merge consecutive same-type selects from same video
      const merged = this.mergeConsecutiveSelects(rawSelects);
      allSelects.push(...merged);
    }

    // Apply filters
    let filtered = allSelects.filter(
      (s) =>
        s.durationSeconds >= minDurationSeconds &&
        s.durationSeconds <= maxDurationSeconds &&
        s.score >= minScore
    );

    if (sceneTypes) {
      filtered = filtered.filter((s) => sceneTypes.includes(s.sceneType));
    }

    // Apply topN per type
    if (topN) {
      const byType = new Map<SceneType, Select[]>();
      for (const s of filtered) {
        const existing = byType.get(s.sceneType) || [];
        existing.push(s);
        byType.set(s.sceneType, existing);
      }
      filtered = [];
      for (const selects of byType.values()) {
        selects.sort((a, b) => b.score - a.score);
        filtered.push(...selects.slice(0, topN));
      }
    }

    // Sort by score descending
    filtered.sort((a, b) => b.score - a.score);
    return filtered;
  }

  buildBins(selects: Select[]): Bin[] {
    const bins: Bin[] = BIN_DEFINITIONS.map((def) => ({
      name: def.name,
      sceneType: def.sceneType,
      selects: selects
        .filter((s) => s.sceneType === def.sceneType)
        .sort((a, b) => b.score - a.score),
      color: def.color,
    }));

    return bins.filter((b) => b.selects.length > 0);
  }

  assembleRoughCut(
    bins: Bin[],
    template: NarrativeTemplate,
    options: AssemblyOptions = {}
  ): RoughCut {
    const usedIds = new Set<string>();
    const clips: TimelineClip[] = [];
    let cursor = 0;
    const fps = options.fps || 30;

    for (const segment of template.segments) {
      // Gather candidates from matching bins
      const candidates: Select[] = [];
      for (const sceneType of segment.sceneTypes) {
        const bin = bins.find((b) => b.sceneType === sceneType);
        if (bin) {
          candidates.push(
            ...bin.selects.filter(
              (s) => !usedIds.has(s.id) || options.allowReuse
            )
          );
        }
      }

      candidates.sort((a, b) => b.score - a.score);

      const bestSelect = this.findBestFit(
        candidates,
        segment.targetDurationSeconds,
        segment.minDurationSeconds,
        segment.maxDurationSeconds
      );

      if (!bestSelect) {
        if (segment.required && candidates.length > 0) {
          const fallback = candidates[0];
          const dur = Math.min(
            fallback.durationSeconds,
            segment.maxDurationSeconds
          );
          clips.push({
            selectId: fallback.id,
            select: fallback,
            timelineInSeconds: cursor,
            timelineOutSeconds: cursor + dur,
            trackIndex: 0,
            transitionType: "cut",
          });
          usedIds.add(fallback.id);
          cursor += dur;
        }
        continue;
      }

      let clipDur = bestSelect.durationSeconds;
      if (clipDur > segment.maxDurationSeconds) {
        clipDur = segment.targetDurationSeconds;
      }

      clips.push({
        selectId: bestSelect.id,
        select: bestSelect,
        timelineInSeconds: cursor,
        timelineOutSeconds: cursor + clipDur,
        trackIndex: 0,
        transitionType: "cut",
      });
      usedIds.add(bestSelect.id);
      cursor += clipDur;
    }

    return {
      name: `Rough Cut - ${template.name}`,
      templateUsed: template.name,
      clips,
      totalDurationSeconds: Math.round(cursor * 10) / 10,
      fps,
      resolution: { width: 1080, height: 1920 },
    };
  }

  generateXmeml(exportData: PremiereExport): string {
    const { fps, resolution, bins, sequences, allSelects, projectName } =
      exportData;
    const ntsc = "FALSE";

    // Collect all unique source files
    const fileMap = new Map<
      string,
      { id: string; pathurl: string; durationFrames: number }
    >();

    for (const sel of allSelects) {
      if (!fileMap.has(sel.sourceVideoPath)) {
        fileMap.set(sel.sourceVideoPath, {
          id: `file-${fileMap.size + 1}`,
          pathurl: sel.sourceVideoPath.startsWith("/")
            ? `file://${sel.sourceVideoPath}`
            : `file:///${sel.sourceVideoPath}`,
          durationFrames: Math.round(
            (sel.timeRange.outSeconds + 60) * fps
          ),
        });
      }
    }

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<!DOCTYPE xmeml>\n`;
    xml += `<xmeml version="4">\n`;
    xml += `  <bin>\n`;
    xml += `    <name>${this.esc(projectName)}</name>\n`;
    xml += `    <children>\n`;

    // Render bins
    for (const bin of bins) {
      xml += this.renderBin(bin, fileMap, fps, resolution, ntsc);
    }

    // Render sequences
    for (const seq of sequences) {
      xml += this.renderSequence(seq, fileMap, fps, resolution, ntsc);
    }

    xml += `    </children>\n`;
    xml += `  </bin>\n`;
    xml += `</xmeml>\n`;

    return xml;
  }

  async generatePremiereProject(
    analysisJsonPath: string,
    outputXmlPath: string,
    options: FullPipelineOptions = {}
  ): Promise<PremiereExport> {
    // Load analysis data
    const raw = await fs.promises.readFile(analysisJsonPath, "utf-8");
    const batch = JSON.parse(raw);
    const analyses: VideoAnalysisResult[] =
      batch.videoAnalyses || batch;

    const fps = options.fps || 30;
    const resolution = options.resolution || { width: 1080, height: 1920 };
    const projectName = options.projectName || "AI Rough Cut";

    // Pipeline
    const selects = this.pullSelects(analyses, options);
    const bins = this.buildBins(selects);

    const templateName =
      options.templateName || "Standard Performance Ad (30s)";
    const template = this.getTemplates().find(
      (t) => t.name === templateName
    )!;
    const roughCut = this.assembleRoughCut(bins, template, { fps });
    roughCut.resolution = resolution;

    const exportData: PremiereExport = {
      projectName,
      bins,
      sequences: [roughCut],
      allSelects: selects,
      fps,
      resolution,
      generatedAt: new Date().toISOString(),
      xmlPath: outputXmlPath,
    };

    const xml = this.generateXmeml(exportData);
    await fs.promises.mkdir(path.dirname(outputXmlPath), { recursive: true });
    await fs.promises.writeFile(outputXmlPath, xml, "utf-8");

    return exportData;
  }

  getTemplates(): NarrativeTemplate[] {
    return [
      {
        name: "Standard Performance Ad (30s)",
        segments: [
          {
            name: "Hook",
            sceneTypes: ["hook"] as SceneType[],
            targetDurationSeconds: 3,
            minDurationSeconds: 1.5,
            maxDurationSeconds: 5,
            required: true,
            notes: "Attention-grabbing opening.",
          },
          {
            name: "Problem Setup",
            sceneTypes: ["body", "testimonial"] as SceneType[],
            targetDurationSeconds: 5,
            minDurationSeconds: 3,
            maxDurationSeconds: 8,
            required: true,
            notes: "Establish the pain point.",
          },
          {
            name: "Solution Introduction",
            sceneTypes: ["body", "product_shot"] as SceneType[],
            targetDurationSeconds: 5,
            minDurationSeconds: 3,
            maxDurationSeconds: 8,
            required: true,
            notes: "Introduce the product.",
          },
          {
            name: "Social Proof",
            sceneTypes: ["testimonial"] as SceneType[],
            targetDurationSeconds: 8,
            minDurationSeconds: 4,
            maxDurationSeconds: 12,
            required: false,
            notes: "Testimonial or results.",
          },
          {
            name: "Product Demo",
            sceneTypes: ["product_shot", "b-roll"] as SceneType[],
            targetDurationSeconds: 4,
            minDurationSeconds: 2,
            maxDurationSeconds: 6,
            required: false,
            notes: "Show the product in action.",
          },
          {
            name: "CTA",
            sceneTypes: ["cta"] as SceneType[],
            targetDurationSeconds: 3,
            minDurationSeconds: 2,
            maxDurationSeconds: 5,
            required: true,
            notes: "Clear call to action.",
          },
        ],
      },
      {
        name: "Quick Hook Ad (15s)",
        segments: [
          {
            name: "Hook",
            sceneTypes: ["hook"] as SceneType[],
            targetDurationSeconds: 2,
            minDurationSeconds: 1,
            maxDurationSeconds: 3,
            required: true,
            notes: "Immediate attention grab.",
          },
          {
            name: "Value Proposition",
            sceneTypes: ["body", "product_shot", "testimonial"] as SceneType[],
            targetDurationSeconds: 8,
            minDurationSeconds: 5,
            maxDurationSeconds: 10,
            required: true,
            notes: "Core message.",
          },
          {
            name: "CTA",
            sceneTypes: ["cta", "product_shot"] as SceneType[],
            targetDurationSeconds: 3,
            minDurationSeconds: 2,
            maxDurationSeconds: 5,
            required: true,
            notes: "Drive action.",
          },
        ],
      },
      {
        name: "Testimonial-Led Ad (45s)",
        segments: [
          {
            name: "Testimonial Hook",
            sceneTypes: ["hook", "testimonial"] as SceneType[],
            targetDurationSeconds: 5,
            minDurationSeconds: 3,
            maxDurationSeconds: 8,
            required: true,
            notes: "Open with compelling personal statement.",
          },
          {
            name: "Problem/Struggle",
            sceneTypes: ["testimonial", "body"] as SceneType[],
            targetDurationSeconds: 8,
            minDurationSeconds: 5,
            maxDurationSeconds: 12,
            required: true,
            notes: "Describe the before state.",
          },
          {
            name: "Discovery",
            sceneTypes: ["body", "product_shot"] as SceneType[],
            targetDurationSeconds: 5,
            minDurationSeconds: 3,
            maxDurationSeconds: 8,
            required: true,
            notes: "How they found the product.",
          },
          {
            name: "Transformation",
            sceneTypes: ["testimonial", "b-roll"] as SceneType[],
            targetDurationSeconds: 10,
            minDurationSeconds: 5,
            maxDurationSeconds: 15,
            required: true,
            notes: "The after state.",
          },
          {
            name: "Product Showcase",
            sceneTypes: ["product_shot"] as SceneType[],
            targetDurationSeconds: 5,
            minDurationSeconds: 3,
            maxDurationSeconds: 8,
            required: false,
            notes: "Close-up product details.",
          },
          {
            name: "CTA",
            sceneTypes: ["cta"] as SceneType[],
            targetDurationSeconds: 4,
            minDurationSeconds: 2,
            maxDurationSeconds: 6,
            required: true,
            notes: "Final push to action.",
          },
        ],
      },
    ];
  }

  async detectFps(filePath: string): Promise<number> {
    try {
      const result = await execFileAsync(FFMPEG_PATH, ["-i", filePath], {
        timeout: 15000,
      }).catch((err) => ({ stderr: (err as any).stderr as string }));
      const stderr = (result as any).stderr || "";
      const match = stderr.match(/([\d.]+)\s*fps/);
      if (match) {
        const fps = parseFloat(match[1]);
        if (Math.abs(fps - 23.976) < 0.1) return 24;
        if (Math.abs(fps - 29.97) < 0.1) return 30;
        if (Math.abs(fps - 59.94) < 0.1) return 60;
        return Math.round(fps);
      }
    } catch {
      // fallback
    }
    return 30;
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private computeTimeRange(
    frame: FrameAnalysis,
    sorted: FrameAnalysis[],
    idx: number,
    videoDuration: number
  ): TimeRange {
    let inSeconds: number;
    if (idx === 0) {
      inSeconds = 0;
    } else {
      const prevTs = sorted[idx - 1].timestampSeconds;
      if (sorted[idx - 1].sceneType === frame.sceneType) {
        inSeconds = prevTs;
      } else {
        inSeconds = (prevTs + frame.timestampSeconds) / 2;
      }
    }

    let outSeconds: number;
    if (idx === sorted.length - 1) {
      outSeconds = videoDuration;
    } else {
      const nextTs = sorted[idx + 1].timestampSeconds;
      if (sorted[idx + 1].sceneType === frame.sceneType) {
        outSeconds = nextTs;
      } else {
        outSeconds = (frame.timestampSeconds + nextTs) / 2;
      }
    }

    return {
      inSeconds: Math.round(inSeconds * 10) / 10,
      outSeconds: Math.round(outSeconds * 10) / 10,
    };
  }

  private scoreSelect(
    frame: FrameAnalysis,
    allFrames: FrameAnalysis[],
    metadata: { durationSeconds: number; videoType: string },
    transcript: string,
    timeRange: TimeRange
  ): { score: number; rationale: string } {
    let score = 50;
    const reasons: string[] = [];
    const duration = timeRange.outSeconds - timeRange.inSeconds;

    // Duration sweet spot
    if (duration >= 2 && duration <= 8) {
      score += 15;
      reasons.push("ideal clip length");
    } else if (duration < 1) {
      score -= 20;
      reasons.push("very short");
    } else if (duration > 15) {
      score -= 10;
      reasons.push("long clip");
    }

    // Scene type bonus
    const bonus = SCENE_TYPE_BONUS[frame.sceneType] || 0;
    score += bonus;
    if (bonus > 0) reasons.push(`high-value ${frame.sceneType}`);

    // On-screen text
    if (frame.onScreenText.length > 0) {
      score += 10;
      reasons.push("has on-screen text");
    }

    // Product visibility
    if (frame.products.length > 0) {
      score += 5;
      reasons.push("product visible");
    }

    // Position in video
    if (frame.timestampSeconds <= 3) {
      score += 10;
      reasons.push("opening moment");
    }
    if (metadata.durationSeconds - frame.timestampSeconds <= 3) {
      score += 5;
      reasons.push("closing moment");
    }

    // Transcript presence
    if (transcript && transcript.length > 20) {
      score += 5;
      reasons.push("has dialogue");
    }

    // Source quality
    if (metadata.videoType === "finished_ad") {
      score += 5;
      reasons.push("from finished ad");
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      rationale: reasons.join("; "),
    };
  }

  private extractTranscriptForRange(
    fullTranscript: string,
    timeRange: TimeRange,
    videoDuration: number
  ): string {
    if (!fullTranscript || videoDuration === 0) return "";
    const ratio = fullTranscript.length / videoDuration;
    const start = Math.floor(timeRange.inSeconds * ratio);
    const end = Math.ceil(timeRange.outSeconds * ratio);
    return fullTranscript.slice(start, end).trim();
  }

  private mergeConsecutiveSelects(selects: Select[]): Select[] {
    if (selects.length <= 1) return selects;

    // Group by source video
    const byVideo = new Map<string, Select[]>();
    for (const s of selects) {
      const key = s.sourceVideoPath;
      const arr = byVideo.get(key) || [];
      arr.push(s);
      byVideo.set(key, arr);
    }

    const merged: Select[] = [];

    for (const videoSelects of byVideo.values()) {
      videoSelects.sort(
        (a, b) => a.timeRange.inSeconds - b.timeRange.inSeconds
      );

      let current = { ...videoSelects[0] };

      for (let i = 1; i < videoSelects.length; i++) {
        const next = videoSelects[i];
        if (
          next.sceneType === current.sceneType &&
          next.timeRange.inSeconds <= current.timeRange.outSeconds + 0.5
        ) {
          // Merge
          current.timeRange.outSeconds = next.timeRange.outSeconds;
          current.durationSeconds =
            Math.round(
              (current.timeRange.outSeconds - current.timeRange.inSeconds) * 10
            ) / 10;
          current.description += "; " + next.description;
          current.onScreenText = [
            ...current.onScreenText,
            ...next.onScreenText,
          ];
          current.products = [
            ...new Set([...current.products, ...next.products]),
          ];
          current.score = Math.max(current.score, next.score);
        } else {
          merged.push(current);
          current = { ...next };
        }
      }
      merged.push(current);
    }

    return merged;
  }

  private findBestFit(
    candidates: Select[],
    target: number,
    min: number,
    max: number
  ): Select | null {
    const inRange = candidates.filter(
      (c) => c.durationSeconds >= min && c.durationSeconds <= max
    );
    if (inRange.length > 0) {
      inRange.sort((a, b) => {
        const distA = Math.abs(a.durationSeconds - target);
        const distB = Math.abs(b.durationSeconds - target);
        if (Math.abs(distA - distB) > 0.5) return distA - distB;
        return b.score - a.score;
      });
      return inRange[0];
    }
    return candidates[0] || null;
  }

  private generateTags(
    frame: FrameAnalysis,
    metadata: { videoType: string; folderContext: string }
  ): string[] {
    const tags: string[] = [frame.sceneType];
    if (metadata.videoType === "finished_ad") tags.push("finished");
    if (metadata.videoType === "raw_clip") tags.push("raw");
    if (frame.visualStyle) tags.push(frame.visualStyle.toLowerCase());
    if (frame.products.length > 0) tags.push("has-product");
    if (frame.onScreenText.length > 0) tags.push("has-text");
    if (frame.people && frame.people !== "No people visible")
      tags.push("has-people");
    return tags;
  }

  private secondsToFrames(seconds: number, fps: number): number {
    return Math.round(seconds * fps);
  }

  private esc(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private generateId(prefix: string): string {
    return `${prefix}-${++this.idCounter}`;
  }

  // ── XMEML Renderers ─────────────────────────────────────────────

  private renderBin(
    bin: Bin,
    fileMap: Map<string, { id: string; pathurl: string; durationFrames: number }>,
    fps: number,
    resolution: { width: number; height: number },
    ntsc: string
  ): string {
    let xml = `      <bin>\n`;
    xml += `        <name>${this.esc(bin.name)}</name>\n`;
    xml += `        <children>\n`;

    for (const select of bin.selects) {
      xml += this.renderClipDef(select, fileMap, fps, resolution, ntsc);
    }

    xml += `        </children>\n`;
    xml += `      </bin>\n`;
    return xml;
  }

  private renderClipDef(
    select: Select,
    fileMap: Map<string, { id: string; pathurl: string; durationFrames: number }>,
    fps: number,
    resolution: { width: number; height: number },
    ntsc: string
  ): string {
    const fileRef = fileMap.get(select.sourceVideoPath);
    if (!fileRef) return "";

    const inFrame = this.secondsToFrames(select.timeRange.inSeconds, fps);
    const outFrame = this.secondsToFrames(select.timeRange.outSeconds, fps);
    const durFrames = outFrame - inFrame;

    let xml = `          <clip id="${this.esc(select.id)}">\n`;
    xml += `            <name>${this.esc(select.sourceFileName)} - ${this.esc(select.sceneType)}</name>\n`;
    xml += `            <duration>${durFrames}</duration>\n`;
    xml += `            <rate><timebase>${fps}</timebase><ntsc>${ntsc}</ntsc></rate>\n`;
    xml += `            <in>${inFrame}</in>\n`;
    xml += `            <out>${outFrame}</out>\n`;
    xml += `            <file id="${fileRef.id}">\n`;
    xml += `              <name>${this.esc(select.sourceFileName)}</name>\n`;
    xml += `              <pathurl>${this.esc(fileRef.pathurl)}</pathurl>\n`;
    xml += `              <rate><timebase>${fps}</timebase><ntsc>${ntsc}</ntsc></rate>\n`;
    xml += `              <media>\n`;
    xml += `                <video><samplecharacteristics>\n`;
    xml += `                  <width>${resolution.width}</width>\n`;
    xml += `                  <height>${resolution.height}</height>\n`;
    xml += `                </samplecharacteristics></video>\n`;
    xml += `                <audio><samplecharacteristics>\n`;
    xml += `                  <samplerate>48000</samplerate>\n`;
    xml += `                  <depth>16</depth>\n`;
    xml += `                </samplecharacteristics></audio>\n`;
    xml += `              </media>\n`;
    xml += `            </file>\n`;
    xml += `            <marker>\n`;
    xml += `              <name>${this.esc(select.sceneType)}: ${this.esc(select.description.slice(0, 100))}</name>\n`;
    xml += `              <in>0</in>\n`;
    xml += `              <out>${durFrames}</out>\n`;
    xml += `              <type>comment</type>\n`;
    xml += `            </marker>\n`;
    xml += `          </clip>\n`;
    return xml;
  }

  private renderSequence(
    roughCut: RoughCut,
    fileMap: Map<string, { id: string; pathurl: string; durationFrames: number }>,
    fps: number,
    resolution: { width: number; height: number },
    ntsc: string
  ): string {
    const totalFrames = this.secondsToFrames(
      roughCut.totalDurationSeconds,
      fps
    );

    let xml = `      <sequence id="seq-${this.generateId("seq")}">\n`;
    xml += `        <name>${this.esc(roughCut.name)}</name>\n`;
    xml += `        <duration>${totalFrames}</duration>\n`;
    xml += `        <rate><timebase>${fps}</timebase><ntsc>${ntsc}</ntsc></rate>\n`;
    xml += `        <timecode>\n`;
    xml += `          <rate><timebase>${fps}</timebase><ntsc>${ntsc}</ntsc></rate>\n`;
    xml += `          <string>00:00:00:00</string>\n`;
    xml += `          <frame>0</frame>\n`;
    xml += `          <source>source</source>\n`;
    xml += `        </timecode>\n`;
    xml += `        <media>\n`;

    // Video tracks
    xml += `          <video>\n`;
    xml += `            <format><samplecharacteristics>\n`;
    xml += `              <width>${resolution.width}</width>\n`;
    xml += `              <height>${resolution.height}</height>\n`;
    xml += `            </samplecharacteristics></format>\n`;
    xml += `            <track>\n`;

    for (const clip of roughCut.clips) {
      xml += this.renderTimelineClip(clip, fileMap, fps, ntsc, "video");
    }

    xml += `            </track>\n`;
    xml += `          </video>\n`;

    // Audio tracks (mirror video)
    xml += `          <audio>\n`;
    xml += `            <track>\n`;

    for (const clip of roughCut.clips) {
      xml += this.renderTimelineClip(clip, fileMap, fps, ntsc, "audio");
    }

    xml += `            </track>\n`;
    xml += `          </audio>\n`;

    xml += `        </media>\n`;
    xml += `      </sequence>\n`;
    return xml;
  }

  private renderTimelineClip(
    clip: TimelineClip,
    fileMap: Map<string, { id: string; pathurl: string; durationFrames: number }>,
    fps: number,
    ntsc: string,
    trackType: "video" | "audio"
  ): string {
    const fileRef = fileMap.get(clip.select.sourceVideoPath);
    if (!fileRef) return "";

    const tlStart = this.secondsToFrames(clip.timelineInSeconds, fps);
    const tlEnd = this.secondsToFrames(clip.timelineOutSeconds, fps);
    const srcIn = this.secondsToFrames(
      clip.select.timeRange.inSeconds,
      fps
    );
    const clipDur = tlEnd - tlStart;
    const srcOut = srcIn + clipDur;
    const prefix = trackType === "audio" ? "a-" : "";

    let xml = `              <clipitem id="ci-${prefix}${this.generateId("ci")}" frameBlend="FALSE">\n`;
    xml += `                <name>${this.esc(clip.select.sourceFileName)} - ${this.esc(clip.select.sceneType)}</name>\n`;
    xml += `                <duration>${clipDur}</duration>\n`;
    xml += `                <rate><timebase>${fps}</timebase><ntsc>${ntsc}</ntsc></rate>\n`;
    xml += `                <start>${tlStart}</start>\n`;
    xml += `                <end>${tlEnd}</end>\n`;
    xml += `                <in>${srcIn}</in>\n`;
    xml += `                <out>${srcOut}</out>\n`;
    xml += `                <file id="${fileRef.id}"/>\n`;
    xml += `              </clipitem>\n`;
    return xml;
  }
}
