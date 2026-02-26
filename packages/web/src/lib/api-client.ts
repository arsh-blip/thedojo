const BASE = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── Drive ──────────────────────────────────────────────────────────────

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
}

export interface FolderResponse {
  folder: DriveItem;
  items: DriveItem[];
}

export interface FileResponse {
  metadata: DriveItem;
  content: string;
}

export const drive = {
  listFolder: (folderId?: string) =>
    request<FolderResponse>(`/api/drive/folder/${folderId || ""}`),

  getFile: (fileId: string) =>
    request<FileResponse>(`/api/drive/file/${fileId}`),

  createFolder: (name: string, parentId: string) =>
    request<DriveItem>("/api/drive/folder", {
      method: "POST",
      body: JSON.stringify({ name, parentId }),
    }),

  createClientStructure: (clientName: string, rootId?: string) =>
    request("/api/drive/client-structure", {
      method: "POST",
      body: JSON.stringify({ clientName, rootId }),
    }),

  search: (q: string, parentId?: string) =>
    request<DriveItem[]>(
      `/api/drive/search?q=${encodeURIComponent(q)}${parentId ? `&parentId=${parentId}` : ""}`
    ),

  createPresentation: (name: string, folderId: string, templateId?: string) =>
    request<DriveItem>("/api/drive/presentation", {
      method: "POST",
      body: JSON.stringify({ name, folderId, templateId }),
    }),

  pullVideos: (folderId: string) =>
    request<{ jobId: string; uploadId: string }>("/api/drive/pull-videos", {
      method: "POST",
      body: JSON.stringify({ folderId }),
    }),
};

// ── Slides ─────────────────────────────────────────────────────────────

export interface SlideInfo {
  slideId: string;
  title?: string;
}

export const slides = {
  list: (presentationId: string) =>
    request<SlideInfo[]>(`/api/slides/${presentationId}`),

  pushConcept: (presentationId: string, concept: Record<string, unknown>) =>
    request(`/api/slides/${presentationId}/concept`, {
      method: "POST",
      body: JSON.stringify(concept),
    }),
};

// ── Video ──────────────────────────────────────────────────────────────

export interface UploadResult {
  uploadId: string;
  files: { name: string; path: string; size: number }[];
}

export interface BatchStartResult {
  jobId: string;
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

export interface VideoAnalysisSummary {
  metadata: {
    filePath: string;
    fileName: string;
    durationSeconds: number;
    width: number;
    height: number;
    codec: string;
    fileSize: number;
    videoType: string;
  };
  frameCount: number;
  transcript: string;
  narrativeStructure: {
    hookTimestamp: number | null;
    bodyTimestamp: number | null;
    ctaTimestamp: number | null;
    totalScenes: number;
  } | null;
  frameAnalyses: {
    timestampSeconds: number;
    sceneType: string;
    description: string;
    onScreenText: string[];
    people: string;
    products: string[];
  }[];
}

export interface BatchStats {
  totalVideos: number;
  successCount: number;
  errorCount: number;
  totalFramesAnalyzed: number;
  estimatedCost: number;
  processingTimeMs: number;
}

export const video = {
  upload: async (files: File[]): Promise<UploadResult> => {
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    const res = await fetch("/api/video/upload", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `Upload failed: ${res.status}`);
    }
    return res.json();
  },

  startBatch: (uploadId: string, brandContext?: string, brandSlug?: string, frameDetail?: string) =>
    request<BatchStartResult>("/api/video/batch", {
      method: "POST",
      body: JSON.stringify({ uploadId, brandContext, brandSlug, frameDetail }),
    }),

  getBatchResults: (jobId: string) =>
    request(`/api/video/batch/${jobId}/results`),

  getSelects: (analysisPath: string, options?: Record<string, unknown>) =>
    request("/api/video/selects", {
      method: "POST",
      body: JSON.stringify({ analysisPath, ...options }),
    }),

  getBins: (analysisPath: string, options?: Record<string, unknown>) =>
    request("/api/video/bins", {
      method: "POST",
      body: JSON.stringify({ analysisPath, ...options }),
    }),

  getRoughCut: (analysisPath: string, options?: Record<string, unknown>) =>
    request("/api/video/rough-cut", {
      method: "POST",
      body: JSON.stringify({ analysisPath, ...options }),
    }),

  exportPremiere: async (options: Record<string, unknown>): Promise<Blob> => {
    const res = await fetch("/api/video/export/premiere", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    if (!res.ok) throw new Error("Export failed");
    return res.blob();
  },

  exportCsv: async (analysisPath: string): Promise<Blob> => {
    const res = await fetch("/api/video/export/csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysisPath }),
    });
    if (!res.ok) throw new Error("CSV export failed");
    return res.blob();
  },

  getTemplates: () => request("/api/video/templates"),

  getBatchSummary: (analysisPath: string) =>
    request<{
      creativeStrategy: CreativeStrategyRow[];
      videoAnalyses: VideoAnalysisSummary[];
      stats: BatchStats | null;
    }>("/api/video/batch-summary", {
      method: "POST",
      body: JSON.stringify({ analysisPath }),
    }),
};

// ── Library ───────────────────────────────────────────────────────────

export interface BrandMeta {
  slug: string;
  name: string;
  createdAt: string;
  analysisCount: number;
  messagingDocId?: string;
  messagingDocName?: string;
}

export interface AnalysisSummary {
  id: string;
  savedAt: string;
  jobId: string;
  videoCount: number;
  clipCount: number;
  brandContext?: string;
}

export interface LibraryClip {
  id: string;
  analysisId: string;
  sourceFileName: string;
  sourceVideoPath: string;
  timeRange: { inSeconds: number; outSeconds: number };
  durationSeconds: number;
  sceneType: string;
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

export const library = {
  listBrands: () => request<BrandMeta[]>("/api/library/brands"),

  createBrand: (name: string) =>
    request<BrandMeta>("/api/library/brands", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  getBrand: (slug: string) =>
    request<BrandMeta>(`/api/library/brands/${slug}`),

  deleteBrand: (slug: string) =>
    request(`/api/library/brands/${slug}`, { method: "DELETE" }),

  updateBrand: (slug: string, updates: { messagingDocId?: string | null; messagingDocName?: string | null }) =>
    request<BrandMeta>(`/api/library/brands/${slug}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),

  getMessagingDocContent: (slug: string) =>
    request<{ fileId: string; fileName: string; content: string }>(
      `/api/library/brands/${slug}/messaging-doc-content`
    ),

  listAnalyses: (brandSlug: string) =>
    request<AnalysisSummary[]>(`/api/library/brands/${brandSlug}/analyses`),

  saveAnalysis: (brandSlug: string, jobId: string, brandContext?: string) =>
    request<AnalysisSummary>(`/api/library/brands/${brandSlug}/analyses`, {
      method: "POST",
      body: JSON.stringify({ jobId, brandContext }),
    }),

  searchClips: (brandSlug: string, params?: Record<string, string>) => {
    const qs = params ? new URLSearchParams(params).toString() : "";
    return request<LibraryClip[]>(
      `/api/library/brands/${brandSlug}/clips${qs ? `?${qs}` : ""}`
    );
  },
};

// ── Jobs ───────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  progress?: {
    videosTotal: number;
    videosCompleted: number;
    framesAnalyzed: number;
    currentVideo: string;
    estimatedSecondsRemaining: number;
    errors: string[];
  };
  result?: Record<string, unknown>;
  error?: string;
}

export const jobs = {
  list: (type?: string) =>
    request<Job[]>(`/api/jobs${type ? `?type=${type}` : ""}`),

  get: (id: string) => request<Job>(`/api/jobs/${id}`),
};
