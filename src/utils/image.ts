import { Request } from "express";
import * as path from "path";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";

const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "gif"];
const UPLOAD_ROOT = path.join(__dirname, "../../static/uploads");

/**
 * Builds the full URL for a stored image.
 * When `req` is available, derives the host from the request (works for any
 * deployment address). When `req` is null/undefined (e.g. called from a
 * helper function without a live request), falls back to BASE_URL env var or
 * a sensible localhost default so that the app never crashes.
 */
export const getImageUrl = (
  req: Request | null | undefined,
  relPath: string | null | undefined
): string | null => {
  if (!relPath) return null;
  const normalizedPath = relPath.replace(/\\/g, "/").replace(/^\//, "");

  let base: string;
  if (req) {
    const protocol = req.protocol;
    const host = req.get("host");
    base = `${protocol}://${host}`;
  } else {
    // Fallback: use BASE_URL env var or localhost default
    base =
      process.env.BASE_URL ||
      `http://localhost:${process.env.PORT || "5000"}`;
  }

  return `${base}/static/uploads/${normalizedPath}`;
};

export const saveImage = (file: Express.Multer.File, subfolder: string): string | null => {
  if (!file) return null;

  const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return null;
  }

  const uniqueFilename = `${uuidv4().replace(/-/g, "")}.${ext}`;
  const targetDir = path.join(UPLOAD_ROOT, subfolder);

  fs.mkdirSync(targetDir, { recursive: true });

  const targetPath = path.join(targetDir, uniqueFilename);
  fs.writeFileSync(targetPath, file.buffer);

  return subfolder ? path.join(subfolder, uniqueFilename) : uniqueFilename;
};

export const deleteImage = (relPath: string | null | undefined): void => {
  if (!relPath) return;
  const targetPath = path.join(UPLOAD_ROOT, relPath);
  if (fs.existsSync(targetPath)) {
    try {
      fs.unlinkSync(targetPath);
    } catch (err) {
      console.error(`Error deleting image at ${targetPath}:`, err);
    }
  }
};
