import express from "express";
import cors from "cors";
import { videoRouter } from "./routes/video.js";
import { driveRouter } from "./routes/drive.js";
import { slidesRouter } from "./routes/slides.js";
import { jobsRouter } from "./routes/jobs.js";
import { libraryRouter } from "./routes/library.js";
import { errorHandler } from "./middleware/error-handler.js";

const app = express();

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : ["http://localhost:3000", "http://127.0.0.1:3000"];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/video", videoRouter);
app.use("/api/drive", driveRouter);
app.use("/api/slides", slidesRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/library", libraryRouter);

// Error handler
app.use(errorHandler);

export { app };
