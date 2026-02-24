import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { v4 as uuid } from "uuid";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Reuse the same uploadId for all files in the batch
    if (!(req as any).uploadId) {
      (req as any).uploadId = uuid();
    }
    const uploadId = (req as any).uploadId;

    // Preserve subfolder structure from the original path
    const relativePath = file.originalname;
    const subdir = path.dirname(relativePath);
    const dir =
      subdir && subdir !== "."
        ? `/tmp/uploads/${uploadId}/${subdir}`
        : `/tmp/uploads/${uploadId}`;

    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    // Use just the basename (the subfolder is handled in destination)
    cb(null, path.basename(file.originalname));
  },
});

export const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".mp4", ".mov"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only MP4 and MOV files are supported"));
    }
  },
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB per file
  },
});
