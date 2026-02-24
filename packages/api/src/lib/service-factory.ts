import {
  createOAuth2Client,
  GoogleDriveService,
  GoogleSlidesService,
  VideoAnalyzerService,
  PremiereXmlGeneratorService,
} from "@thedojo/services";

let driveService: GoogleDriveService | null = null;
let slidesService: GoogleSlidesService | null = null;
let videoService: VideoAnalyzerService | null = null;
const premiereService = new PremiereXmlGeneratorService();

export function getDriveService(): GoogleDriveService {
  if (!driveService) {
    driveService = new GoogleDriveService(createOAuth2Client());
  }
  return driveService;
}

export function getSlidesService(): GoogleSlidesService {
  if (!slidesService) {
    slidesService = new GoogleSlidesService(createOAuth2Client());
  }
  return slidesService;
}

export function getVideoService(): VideoAnalyzerService {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  if (!videoService) {
    videoService = new VideoAnalyzerService(apiKey);
  }
  return videoService;
}

export function getPremiereService(): PremiereXmlGeneratorService {
  return premiereService;
}
