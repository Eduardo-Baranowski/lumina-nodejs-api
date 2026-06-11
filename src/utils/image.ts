import { Request } from "express";
import * as path from "path";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { v2 as cloudinary } from "cloudinary";

const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "gif"];

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

const UPLOAD_ROOT = isServerless
  ? "/tmp/uploads"
  : path.join(__dirname, "../../static/uploads");

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

export const saveImage = async (
  file: Express.Multer.File,
  subfolder: string
): Promise<string | null> => {
  if (!file) return null;

  const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return null;
  }

  try {
    // Se Cloudinary está disponível em produção, usar ele
    if (isCloudinaryEnabled) {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `lumina/${subfolder}`,
            resource_type: "auto",
          },
          (error, result) => {
            if (error) {
              console.error("Cloudinary upload error:", error);
              reject(error);
            } else if (result) {
              // Retornar URL completa da imagem no Cloudinary
              console.log(`✓ Image uploaded to Cloudinary: ${result.secure_url}`);
              resolve(result.secure_url);
            }
          }
        );
        stream.end(file.buffer);
      });
    }

    // Fallback: usar filesystem local (dev ou se Cloudinary não estiver configurado)
    const uniqueFilename = `${uuidv4().replace(/-/g, "")}.${ext}`;
    const targetDir = path.join(UPLOAD_ROOT, subfolder);

    fs.mkdirSync(targetDir, { recursive: true });

    const targetPath = path.join(targetDir, uniqueFilename);
    fs.writeFileSync(targetPath, file.buffer);

    const relPath = subfolder ? path.join(subfolder, uniqueFilename) : uniqueFilename;
    console.log(`✓ Image saved locally: ${relPath}`);
    return relPath;
  } catch (err) {
    console.error(`Error saving image: ${err}`);
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
