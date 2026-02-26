import { Router } from "express";
import * as store from "../lib/library-store.js";
import { getDriveService } from "../lib/service-factory.js";
import type { SceneType } from "@thedojo/services";

const router = Router();

// ── Brands ───────────────────────────────────────────────────────────

router.get("/brands", (_req, res) => {
  res.json(store.listBrands());
});

router.post("/brands", (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const brand = store.createBrand(name.trim());
    res.status(201).json(brand);
  } catch (err: any) {
    if (err.message?.includes("already exists")) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get("/brands/:slug", (req, res) => {
  const brand = store.getBrand(req.params.slug);
  if (!brand) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }
  res.json(brand);
});

router.delete("/brands/:slug", (req, res) => {
  store.deleteBrand(req.params.slug);
  res.json({ ok: true });
});

router.patch("/brands/:slug", (req, res, next) => {
  try {
    const { messagingDocId, messagingDocName } = req.body;
    const brand = store.updateBrand(req.params.slug, {
      messagingDocId,
      messagingDocName,
    });
    res.json(brand);
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get("/brands/:slug/messaging-doc-content", async (req, res, next) => {
  try {
    const brand = store.getBrand(req.params.slug);
    if (!brand) {
      res.status(404).json({ error: "Brand not found" });
      return;
    }
    if (!brand.messagingDocId) {
      res.status(404).json({ error: "No messaging doc linked to this brand" });
      return;
    }
    const driveService = getDriveService();
    const content = await driveService.getDocumentContent(brand.messagingDocId);
    res.json({
      fileId: brand.messagingDocId,
      fileName: brand.messagingDocName,
      content,
    });
  } catch (err) {
    next(err);
  }
});

// ── Analyses ─────────────────────────────────────────────────────────

router.get("/brands/:slug/analyses", (req, res, next) => {
  try {
    const analyses = store.listAnalyses(req.params.slug);
    res.json(analyses);
  } catch (err) {
    next(err);
  }
});

router.post("/brands/:slug/analyses", (req, res, next) => {
  try {
    const { jobId, brandContext } = req.body;
    if (!jobId) {
      res.status(400).json({ error: "jobId is required" });
      return;
    }
    const brand = store.getBrand(req.params.slug);
    if (!brand) {
      res.status(404).json({ error: "Brand not found" });
      return;
    }
    const analysis = store.saveAnalysis(req.params.slug, jobId, brandContext);
    res.status(201).json(analysis);
  } catch (err) {
    next(err);
  }
});

router.get("/brands/:slug/analyses/:analysisId", (req, res) => {
  const analysis = store.getAnalysis(req.params.slug, req.params.analysisId);
  if (!analysis) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }
  res.json(analysis);
});

router.delete("/brands/:slug/analyses/:analysisId", (req, res) => {
  store.deleteAnalysis(req.params.slug, req.params.analysisId);
  res.json({ ok: true });
});

// ── Clips ────────────────────────────────────────────────────────────

router.get("/brands/:slug/clips", (req, res, next) => {
  try {
    const { sceneType, minScore, search, product, analysisId, sortBy, sortDir, limit, offset } =
      req.query as Record<string, string | undefined>;

    const clips = store.searchClips(req.params.slug, {
      sceneTypes: sceneType
        ? (sceneType.split(",") as SceneType[])
        : undefined,
      minScore: minScore ? Number(minScore) : undefined,
      searchText: search,
      product,
      analysisId,
      sortBy: sortBy as "score" | "duration" | "sceneType" | undefined,
      sortDir: sortDir as "asc" | "desc" | undefined,
      limit: limit ? Number(limit) : 100,
      offset: offset ? Number(offset) : 0,
    });

    res.json(clips);
  } catch (err) {
    next(err);
  }
});

export { router as libraryRouter };
