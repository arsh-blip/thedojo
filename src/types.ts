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

// ── Video Analysis Types ─────────────────────────────────────────────

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  fileSize: number;
  format: string;
  hasAudio: boolean;
}

export interface ExtractedFrame {
  timestamp: number;
  base64: string;
  isSceneChange: boolean;
}

export interface SceneSegment {
  startTime: number;
  endTime: number;
  duration: number;
}

export interface TranscriptSegment {
  text: string;
  startTime: number;
  endTime: number;
}

// ── Brand Creative Strategy Types ─────────────────────────────────────

/** A single creative strategy pillar/angle from the brand's strategy doc */
export interface CreativeStrategyPillar {
  naming_convention: string;
  priority: string;
  persona: string;
  angle: string;
  sub_angles: string[];
  primary_benefits: string[];
  description: string;
  emotional_fear: string;
  problem_solution_promise: string;
  before_after: string;
  frameworks: string[];
  example_headline: string;
  example_testimonial: string;
  example_ugc_hook: string;
  key_points_framing: string[];
  objections: string[];
}

/** Full creative strategy for a brand (array of pillars) */
export interface BrandCreativeStrategy {
  pillars: CreativeStrategyPillar[];
  updated_at: string;
}

/** A saved review for brand context */
export interface BrandReview {
  id: string;
  source: string;
  text: string;
  rating?: number;
  date?: string;
  themes?: string[];
  added_at: string;
}

/** A saved top-performing ad reference */
export interface TopPerformingAd {
  id: string;
  brand_source: string;
  headline?: string;
  body_copy?: string;
  description?: string;
  ad_url?: string;
  platform?: string;
  format?: string;
  why_it_works?: string;
  metrics_notes?: string;
  video_id?: string;
  added_at: string;
}

/** Brand profile / config */
export interface BrandProfile {
  slug: string;
  name: string;
  product?: string;
  target_audience?: string;
  brand_voice?: {
    tone: string;
    style: string;
    dos: string[];
    donts: string[];
  };
  created_at: string;
  updated_at: string;
}

/** Full brand context loaded from disk */
export interface BrandContext {
  profile: BrandProfile;
  strategy?: BrandCreativeStrategy;
  reviews: BrandReview[];
  top_ads: TopPerformingAd[];
}

// ── Concept Session Types (Iterative Refinement) ─────────────────────

export interface ConceptIteration {
  iterationNumber: number;
  concept: string;
  feedback?: string;
  timestamp: Date;
}

export interface ConceptSession {
  id: string;
  videoId: string;
  brand: string;
  product?: string;
  targetAudience?: string;
  videoAnalysisSummary: string;
  iterations: ConceptIteration[];
  createdAt: Date;
}
