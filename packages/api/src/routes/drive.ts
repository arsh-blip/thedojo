import { Router } from "express";
import { getDriveService } from "../lib/service-factory.js";

const router = Router();

// List folder contents
router.get("/folder{/:folderId}", async (req, res, next) => {
  try {
    const drive = getDriveService();
    const folderId =
      (req.params as any).folderId || "1ttQlzxwqEqvt3keHwKAcXn33TnkT5bos";
    const items = await drive.listFolder(folderId);
    const metadata = await drive.getFileMetadata(folderId);
    res.json({ folder: metadata, items });
  } catch (err) {
    next(err);
  }
});

// Get file metadata + content
router.get("/file/:fileId", async (req, res, next) => {
  try {
    const drive = getDriveService();
    const metadata = await drive.getFileMetadata(req.params.fileId);
    const content = await drive.getDocumentContent(req.params.fileId);
    res.json({ metadata, content });
  } catch (err) {
    next(err);
  }
});

// Create folder
router.post("/folder", async (req, res, next) => {
  try {
    const drive = getDriveService();
    const { name, parentId } = req.body;
    if (!name || !parentId) {
      res.status(400).json({ error: "name and parentId are required" });
      return;
    }
    const folder = await drive.createFolder(name, parentId);
    res.json(folder);
  } catch (err) {
    next(err);
  }
});

// Setup client folder structure
router.post("/client-structure", async (req, res, next) => {
  try {
    const drive = getDriveService();
    const { clientName, rootId } = req.body;
    if (!clientName) {
      res.status(400).json({ error: "clientName is required" });
      return;
    }
    const result = await drive.createClientFolderStructure(
      clientName,
      rootId || "1ttQlzxwqEqvt3keHwKAcXn33TnkT5bos"
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Search files
router.get("/search", async (req, res, next) => {
  try {
    const drive = getDriveService();
    const q = req.query.q as string;
    const parentId = req.query.parentId as string | undefined;
    if (!q) {
      res.status(400).json({ error: "q (query) is required" });
      return;
    }
    const files = await drive.searchFiles(q, parentId);
    res.json(files);
  } catch (err) {
    next(err);
  }
});

// Create presentation
router.post("/presentation", async (req, res, next) => {
  try {
    const drive = getDriveService();
    const { name, folderId, templateId } = req.body;
    if (!name || !folderId) {
      res.status(400).json({ error: "name and folderId are required" });
      return;
    }
    let file;
    if (templateId) {
      file = await drive.copyFile(templateId, name, folderId);
    } else {
      file = await drive.createPresentation(name, folderId);
    }
    res.json(file);
  } catch (err) {
    next(err);
  }
});

export { router as driveRouter };
