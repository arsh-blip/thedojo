import { Router } from "express";
import { getSlidesService } from "../lib/service-factory.js";
import type { ConceptSlideData } from "@thedojo/services";

const router = Router();

// List slides in a presentation
router.get("/:presentationId", async (req, res, next) => {
  try {
    const slides = getSlidesService();
    const slideList = await slides.listSlides(req.params.presentationId);
    res.json(slideList);
  } catch (err) {
    next(err);
  }
});

// Add a new concept slide
router.post("/:presentationId/concept", async (req, res, next) => {
  try {
    const slides = getSlidesService();
    const concept: ConceptSlideData = req.body;
    const slideUrl = await slides.addConceptSlide(
      req.params.presentationId,
      concept
    );
    res.json({ slideUrl });
  } catch (err) {
    next(err);
  }
});

// Update a template slide with concept data
router.post("/:presentationId/concept/template", async (req, res, next) => {
  try {
    const slides = getSlidesService();
    const { templateSlideId, concept } = req.body;
    if (!templateSlideId) {
      res.status(400).json({ error: "templateSlideId is required" });
      return;
    }
    const slideUrl = await slides.updateConceptSlide(
      req.params.presentationId,
      templateSlideId,
      concept as ConceptSlideData
    );
    res.json({ slideUrl });
  } catch (err) {
    next(err);
  }
});

export { router as slidesRouter };
