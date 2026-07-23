import { Request } from "express";
import * as path from "path";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { v2 as cloudinary } from "cloudinary";

const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export const UNSUPPORTED_IMAGE_MESSAGE =
  "Formato de imagem não suportado. Use JPG, PNG, GIF ou WebP.";

/** Resolve extensão a partir do nome do arquivo ou do Content-Type do upload. */
export function resolveImageExtension(file: Express.Multer.File): string | null {
  const fromName = path.extname(file.originalname).toLowerCase().replace(".", "");
  if (ALLOWED_EXTENSIONS.includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }

  const fromMime = MIME_TO_EXT[file.mimetype?.toLowerCase() ?? ""];
  if (fromMime) return fromMime;

  return null;
}

const resolveBufferImageExtension = (originalname: string, mimetype?: string): string | null => {
  const fromName = path.extname(originalname).toLowerCase().replace(".", "");
  if (ALLOWED_EXTENSIONS.includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }

  if (mimetype) {
    const fromMime = MIME_TO_EXT[mimetype.toLowerCase()];
    if (fromMime) return fromMime;
  }

  return null;
};

// Use /tmp em serverless (Vercel), caso contrário use static/uploads local
const isServerless = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
const isCloudinaryEnabled = isServerless && process.env.CLOUDINARY_CLOUD_NAME;

// Configure Cloudinary se disponível
if (isCloudinaryEnabled) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

export const UPLOAD_ROOT = isServerless
  ? "/tmp/uploads"
  : path.join(__dirname, "../../static/uploads");

/**
 * Builds the full URL for a stored image.
 * - If the path is already a full URL (starts with http/https/data), returns it as-is
 * - If it's a relative path, builds a /static/uploads URL
 * When `req` is available, derives the host from the request. When `req` is
 * null/undefined, falls back to BASE_URL env var or localhost.
 */
export const getImageUrl = (
  req: Request | null | undefined,
  relPath: string | null | undefined
): string | null => {
  if (!relPath) return null;

  // If it's already a full URL (from Cloudinary or similar), return as-is
  if (relPath.startsWith("http://") || relPath.startsWith("https://") || relPath.startsWith("data:")) {
    return relPath;
  }

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

export const saveImage = async (
  file: Express.Multer.File,
  subfolder: string
): Promise<string | null> => {
  if (!file) return null;

  const ext = resolveImageExtension(file);
  if (!ext) {
    console.warn(
      `Rejected image upload: ext=${path.extname(file.originalname)} mime=${file.mimetype}`
    );
    return null;
  }

  return await saveBufferImage(file.buffer, file.originalname, file.mimetype, subfolder, UPLOAD_ROOT);
};

export const saveBufferImage = async (
  buffer: Buffer,
  originalname: string,
  mimetype: string | undefined,
  subfolder: string,
  uploadFolder: string
): Promise<string | null> => {
  const ext = resolveBufferImageExtension(originalname, mimetype);
  if (!ext) {
    console.warn(`Rejected image buffer: name=${originalname} mime=${mimetype}`);
    return null;
  }

  try {
    if (isCloudinaryEnabled) {
      return new Promise((resolve, reject) => {
        const publicId = uuidv4().replace(/-/g, "");
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `lumina/${subfolder}`,
            resource_type: "auto",
            public_id: publicId,
          },
          (error, result) => {
            if (error) {
              console.error("Cloudinary upload error:", error);
              reject(error);
            } else if (result) {
              console.log(`✓ Image uploaded to Cloudinary: ${result.secure_url}`);
              resolve(result.secure_url);
            }
          }
        );
        stream.end(buffer);
      });
    }

    const uniqueFilename = `${uuidv4().replace(/-/g, "")}.${ext}`;
    const targetDir = path.join(uploadFolder, subfolder);
    fs.mkdirSync(targetDir, { recursive: true });

    const targetPath = path.join(targetDir, uniqueFilename);
    fs.writeFileSync(targetPath, buffer);

    const relPath = subfolder ? path.join(subfolder, uniqueFilename) : uniqueFilename;
    console.log(`✓ Image saved locally: ${relPath}`);
    return relPath;
  } catch (err) {
    console.error(`Error saving image buffer: ${err}`);
    throw err;
  }
};

export const deleteImage = (relPath: string | null | undefined): void => {
  if (!relPath) return;
  try {
    const targetPath = path.join(UPLOAD_ROOT, relPath);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  } catch (err) {
    console.error(`Error deleting image: ${err}`);
    // Não falhar a requisição se a deleção falhar
  }
};
