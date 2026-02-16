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

// ── Video Ad Analysis Types ────────────────────────────────────────

export interface VideoAdEntry {
  filename: string;
  file_path: string;
  file_size_bytes: number;
  duration_seconds: number;
  resolution: { width: number; height: number };
  aspect_ratio: string;
  transcript: string | null;
  key_frame_paths: string[];
  analyzed_at: string;
}

export interface VideoAdCatalog {
  brand: string;
  created_at: string;
  updated_at: string;
  source_folder: string;
  videos: VideoAdEntry[];
}
