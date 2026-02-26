import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PremiereXmlGeneratorService,
  type VideoAnalysisResult,
  type Select,
  type SceneType,
} from "@thedojo/services";
import { jobManager } from "./job-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, "../../../../data/brands");

// ── Types ────────────────────────────────────────────────────────────

export interface BrandMeta {
  slug: string;
  name: string;
  createdAt: string;
  analysisCount: number;
  messagingDocId?: string;
  messagingDocName?: string;
}

export interface LibraryAnalysis {
  id: string;
  brandSlug: string;
  savedAt: string;
  jobId: string;
  brandContext?: string;
  batch: {
    videoAnalyses: VideoAnalysisResult[];
    creativeStrategy: unknown[];
    stats: Record<string, unknown>;
  };
}

export interface AnalysisSummary {
  id: string;
  savedAt: string;
  jobId: string;
  videoCount: number;
  clipCount: number;
  brandContext?: string;
}

export interface ClipFilters {
  sceneTypes?: SceneType[];
  minScore?: number;
  searchText?: string;
  product?: string;
  analysisId?: string;
  sortBy?: "score" | "duration" | "sceneType";
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface ClipWithContext extends Select {
  analysisId: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function brandDir(slug: string): string {
  return path.join(DATA_ROOT, slug);
}

function brandMetaPath(slug: string): string {
  return path.join(brandDir(slug), "brand.json");
}

function analysesDir(slug: string): string {
  return path.join(brandDir(slug), "analyses");
}

// ── Brand CRUD ───────────────────────────────────────────────────────

export function listBrands(): BrandMeta[] {
  ensureDir(DATA_ROOT);
  const entries = fs.readdirSync(DATA_ROOT, { withFileTypes: true });
  const brands: BrandMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = brandMetaPath(entry.name);
    if (fs.existsSync(metaPath)) {
      brands.push(JSON.parse(fs.readFileSync(metaPath, "utf-8")));
    }
  }
  return brands.sort((a, b) => a.name.localeCompare(b.name));
}

export function getBrand(slug: string): BrandMeta | null {
  const metaPath = brandMetaPath(slug);
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
}

export function createBrand(name: string): BrandMeta {
  const slug = slugify(name);
  if (!slug) throw new Error("Invalid brand name");
  const dir = brandDir(slug);
  if (fs.existsSync(brandMetaPath(slug))) {
    throw new Error(`Brand "${name}" already exists`);
  }
  ensureDir(dir);
  ensureDir(analysesDir(slug));
  const meta: BrandMeta = {
    slug,
    name,
    createdAt: new Date().toISOString(),
    analysisCount: 0,
  };
  fs.writeFileSync(brandMetaPath(slug), JSON.stringify(meta, null, 2));
  return meta;
}

export function deleteBrand(slug: string): void {
  const dir = brandDir(slug);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function updateBrand(
  slug: string,
  updates: { messagingDocId?: string | null; messagingDocName?: string | null }
): BrandMeta {
  const brand = getBrand(slug);
  if (!brand) throw new Error(`Brand not found: ${slug}`);
  if (updates.messagingDocId !== undefined) {
    brand.messagingDocId = updates.messagingDocId ?? undefined;
  }
  if (updates.messagingDocName !== undefined) {
    brand.messagingDocName = updates.messagingDocName ?? undefined;
  }
  fs.writeFileSync(brandMetaPath(slug), JSON.stringify(brand, null, 2));
  return brand;
}

// ── Analysis CRUD ────────────────────────────────────────────────────

function resolveJobResultPath(jobId: string): string {
  // Try job manager first (in-memory)
  const job = jobManager.getJob(jobId);
  if (job?.result) {
    const resultPath = (job.result as any).resultPath;
    if (resultPath && fs.existsSync(resultPath)) return resultPath;
  }
  // Try conventional path
  const conventionalPath = `/tmp/video-analysis/batch_${jobId}.json`;
  if (fs.existsSync(conventionalPath)) return conventionalPath;
  throw new Error(`Analysis results not found for job: ${jobId}`);
}

export function listAnalyses(brandSlug: string): AnalysisSummary[] {
  const dir = analysesDir(brandSlug);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const premiereService = new PremiereXmlGeneratorService();

  return files
    .map((filename) => {
      const filePath = path.join(dir, filename);
      const data: LibraryAnalysis = JSON.parse(
        fs.readFileSync(filePath, "utf-8")
      );
      const selects = premiereService.pullSelects(
        data.batch.videoAnalyses,
        { minScore: 0 }
      );
      return {
        id: data.id,
        savedAt: data.savedAt,
        jobId: data.jobId,
        videoCount: data.batch.videoAnalyses.length,
        clipCount: selects.length,
        brandContext: data.brandContext,
      };
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function getAnalysis(
  brandSlug: string,
  analysisId: string
): LibraryAnalysis | null {
  const dir = analysesDir(brandSlug);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const filename of files) {
    const filePath = path.join(dir, filename);
    const data: LibraryAnalysis = JSON.parse(
      fs.readFileSync(filePath, "utf-8")
    );
    if (data.id === analysisId) return data;
  }
  return null;
}

export function saveAnalysis(
  brandSlug: string,
  jobId: string,
  brandContext?: string
): AnalysisSummary {
  const brand = getBrand(brandSlug);
  if (!brand) throw new Error(`Brand not found: ${brandSlug}`);

  const sourcePath = resolveJobResultPath(jobId);
  const batchData = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));

  const date = new Date().toISOString().slice(0, 10);
  const shortId = jobId.slice(0, 8);
  const analysisId = `${date}_batch_${shortId}`;

  const libraryAnalysis: LibraryAnalysis = {
    id: analysisId,
    brandSlug,
    savedAt: new Date().toISOString(),
    jobId,
    brandContext,
    batch: batchData,
  };

  ensureDir(analysesDir(brandSlug));
  const destPath = path.join(analysesDir(brandSlug), `${analysisId}.json`);
  fs.writeFileSync(destPath, JSON.stringify(libraryAnalysis, null, 2));

  // Update brand metadata
  brand.analysisCount += 1;
  fs.writeFileSync(brandMetaPath(brandSlug), JSON.stringify(brand, null, 2));

  const premiereService = new PremiereXmlGeneratorService();
  const selects = premiereService.pullSelects(batchData.videoAnalyses, {
    minScore: 0,
  });

  return {
    id: analysisId,
    savedAt: libraryAnalysis.savedAt,
    jobId,
    videoCount: batchData.videoAnalyses?.length || 0,
    clipCount: selects.length,
    brandContext,
  };
}

export function deleteAnalysis(
  brandSlug: string,
  analysisId: string
): void {
  const dir = analysesDir(brandSlug);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const filename of files) {
    const filePath = path.join(dir, filename);
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (data.id === analysisId) {
      fs.unlinkSync(filePath);
      // Update brand metadata
      const brand = getBrand(brandSlug);
      if (brand) {
        brand.analysisCount = Math.max(0, brand.analysisCount - 1);
        fs.writeFileSync(
          brandMetaPath(brandSlug),
          JSON.stringify(brand, null, 2)
        );
      }
      return;
    }
  }
}

// ── Clip Search ──────────────────────────────────────────────────────

export function searchClips(
  brandSlug: string,
  filters: ClipFilters = {}
): ClipWithContext[] {
  const dir = analysesDir(brandSlug);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const premiereService = new PremiereXmlGeneratorService();
  let allClips: ClipWithContext[] = [];

  for (const filename of files) {
    const filePath = path.join(dir, filename);
    const data: LibraryAnalysis = JSON.parse(
      fs.readFileSync(filePath, "utf-8")
    );

    if (filters.analysisId && data.id !== filters.analysisId) continue;

    const selects = premiereService.pullSelects(data.batch.videoAnalyses, {
      sceneTypes: filters.sceneTypes,
      minScore: filters.minScore ?? 0,
    });

    const withContext: ClipWithContext[] = selects.map((s) => ({
      ...s,
      analysisId: data.id,
    }));
    allClips.push(...withContext);
  }

  // Product filter
  if (filters.product) {
    const pq = filters.product.toLowerCase();
    allClips = allClips.filter((c) =>
      c.products.some((p) => p.toLowerCase().includes(pq))
    );
  }

  // Text search
  if (filters.searchText) {
    const q = filters.searchText.toLowerCase();
    allClips = allClips.filter(
      (c) =>
        c.description.toLowerCase().includes(q) ||
        c.transcript.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        c.onScreenText.some((t) => t.toLowerCase().includes(q)) ||
        c.products.some((p) => p.toLowerCase().includes(q)) ||
        c.sourceFileName.toLowerCase().includes(q)
    );
  }

  // Sort
  const sortBy = filters.sortBy || "score";
  const sortDir = filters.sortDir || "desc";
  const mult = sortDir === "desc" ? -1 : 1;
  allClips.sort((a, b) => {
    if (sortBy === "score") return mult * (a.score - b.score);
    if (sortBy === "duration")
      return mult * (a.durationSeconds - b.durationSeconds);
    if (sortBy === "sceneType")
      return mult * a.sceneType.localeCompare(b.sceneType);
    return 0;
  });

  // Pagination
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 100;
  return allClips.slice(offset, offset + limit);
}
