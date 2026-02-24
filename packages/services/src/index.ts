// Types
export type {
  FacebookAd,
  AdSearchParams,
  AdSearchResult,
  MessagingAngle,
  MessagingDocument,
  AngleRecommendation,
  AdCopy,
  ConceptSlideData,
  VideoMetadata,
  ExtractedFrame,
  FrameAnalysis,
  VideoAnalysisResult,
  CreativeStrategyRow,
  BatchAnalysisResult,
  SceneType,
  TimeRange,
  Select,
  Bin,
  TimelineClip,
  NarrativeSegment,
  NarrativeTemplate,
  RoughCut,
  PremiereExport,
  PullSelectsOptions,
  AssemblyOptions,
  FullPipelineOptions,
} from "./types.js";

// Services
export { createOAuth2Client } from "./services/google-auth.js";
export { GoogleDriveService } from "./services/google-drive.js";
export type { DriveItem } from "./services/google-drive.js";
export { GoogleSlidesService } from "./services/google-slides.js";
export { MetaAdLibraryService } from "./services/meta-ad-library.js";
export { VideoAnalyzerService } from "./services/video-analyzer.js";
export type { BatchOptions } from "./services/video-analyzer.js";
export { PremiereXmlGeneratorService } from "./services/premiere-xml-generator.js";
