export interface FacebookAd {
  id: string;
  ad_creation_time: string;
  ad_delivery_start_time: string;
  ad_delivery_stop_time?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_captions?: string[];
  ad_creative_link_descriptions?: string[];
  ad_creative_link_titles?: string[];
  ad_snapshot_url?: string;
  page_id: string;
  page_name: string;
  bylines?: string;
  publisher_platforms?: string[];
  estimated_audience_size?: {
    lower_bound: number;
    upper_bound: number;
  };
}

export interface AdSearchParams {
  search_terms: string;
  ad_reached_countries: string[];
  ad_type?: "ALL" | "POLITICAL_AND_ISSUE_ADS";
  ad_active_status?: "ALL" | "ACTIVE" | "INACTIVE";
  limit?: number;
  search_page_ids?: string[];
  media_type?: "ALL" | "IMAGE" | "MEME" | "VIDEO" | "NONE";
}

export interface AdSearchResult {
  ads: FacebookAd[];
  total_count: number;
}

export interface MessagingAngle {
  name: string;
  description: string;
  hooks: string[];
  target_audience: string;
  value_propositions: string[];
  tone: string;
}

export interface MessagingDocument {
  brand: string;
  product?: string;
  angles: MessagingAngle[];
  brand_voice: {
    tone: string;
    style: string;
    dos: string[];
    donts: string[];
  };
  key_benefits: string[];
  target_demographics: string[];
}

export interface AngleRecommendation {
  angle_name: string;
  relevance_score: number;
  rationale: string;
  suggested_hooks: string[];
  reference_ad_alignment: string;
}

export interface AdCopy {
  variation_name: string;
  primary_text: string;
  headline: string;
  description: string;
  cta: string;
  angle: string;
  hook_used: string;
}

export interface ConceptSlideData {
  concept_name: string;
  brand: string;
  angle: string;
  reference_ad_url?: string;
  reference_ad_summary: string;
  copy_variations: AdCopy[];
  visual_direction: string;
  target_audience: string;
  key_messaging_points: string[];
}

// ── Video Analysis Types ──────────────────────────────────────────

export interface VideoMetadata {
  filePath: string;
  fileName: string;
  durationSeconds: number;
  width: number;
  height: number;
  codec: string;
  fileSize: number;
  videoType: "finished_ad" | "raw_clip";
  folderContext: string;
  driveFileId?: string;
  driveWebViewLink?: string;
}

export interface ExtractedFrame {
  framePath: string;
  timestampSeconds: number;
  base64Data?: string;
}

export interface FrameAnalysis {
  timestampSeconds: number;
  sceneType: "hook" | "body" | "cta" | "b-roll" | "transition" | "testimonial" | "product_shot";
  onScreenText: string[];
  people: string;
  products: string[];
  setting: string;
  visualStyle: string;
  description: string;
}

export interface VideoAnalysisResult {
  metadata: VideoMetadata;
  frameAnalyses: FrameAnalysis[];
  transcript: string;
  narrativeStructure: {
    hookTimestamp: number | null;
    bodyTimestamp: number | null;
    ctaTimestamp: number | null;
    totalScenes: number;
    sceneBreakdown: Record<string, number>;
  };
}

export interface CreativeStrategyRow {
  namingConvention: string;
  priority: number;
  persona: string;
  angle: string;
  subAngles: string;
  primaryBenefits: string;
  description: string;
  emotionalFear: string;
  problemSolutionPromise: string;
  beforeAfterFrameworks: string;
  exampleHeadline: string;
  exampleTestimonial: string;
  exampleUGCHook: string;
  keyPointsFraming: string;
  objections: string;
}

export interface BatchAnalysisResult {
  videoAnalyses: VideoAnalysisResult[];
  creativeStrategy: CreativeStrategyRow[];
  stats: {
    totalVideos: number;
    successCount: number;
    errorCount: number;
    totalFramesAnalyzed: number;
    estimatedCost: number;
    processingTimeMs: number;
  };
}

// ── Premiere Pro / Edit Types ───────────────────────────────────────

export type SceneType = FrameAnalysis["sceneType"];

export interface TimeRange {
  inSeconds: number;
  outSeconds: number;
}

export interface Select {
  id: string;
  sourceVideoPath: string;
  sourceFileName: string;
  timeRange: TimeRange;
  durationSeconds: number;
  sceneType: SceneType;
  score: number;
  scoreRationale: string;
  description: string;
  transcript: string;
  onScreenText: string[];
  people: string;
  products: string[];
  tags: string[];
  driveFileId?: string;
  driveWebViewLink?: string;
}

export interface Bin {
  name: string;
  sceneType: SceneType;
  selects: Select[];
  color?: string;
}

export interface TimelineClip {
  selectId: string;
  select: Select;
  timelineInSeconds: number;
  timelineOutSeconds: number;
  trackIndex: number;
  transitionType?: "cut" | "dissolve";
}

export interface NarrativeSegment {
  name: string;
  sceneTypes: SceneType[];
  targetDurationSeconds: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  required: boolean;
  notes: string;
}

export interface NarrativeTemplate {
  name: string;
  segments: NarrativeSegment[];
}

export interface RoughCut {
  name: string;
  templateUsed: string;
  clips: TimelineClip[];
  totalDurationSeconds: number;
  fps: number;
  resolution: { width: number; height: number };
}

export interface PremiereExport {
  projectName: string;
  bins: Bin[];
  sequences: RoughCut[];
  allSelects: Select[];
  fps: number;
  resolution: { width: number; height: number };
  generatedAt: string;
  xmlPath?: string;
}

export interface PullSelectsOptions {
  sceneTypes?: SceneType[];
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  minScore?: number;
  topN?: number;
  basePath?: string;
}

export interface AssemblyOptions {
  targetDurationSeconds?: number;
  preferHighScoring?: boolean;
  allowReuse?: boolean;
  fps?: number;
}

export interface FullPipelineOptions extends PullSelectsOptions, AssemblyOptions {
  projectName?: string;
  templateName?: string;
  resolution?: { width: number; height: number };
}
