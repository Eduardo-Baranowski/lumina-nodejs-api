import * as fs from "fs";
import * as path from "path";
import { v2 as cloudinary } from "cloudinary";
import { AppDataSource } from "../config/database";
import { User } from "../entities/User";

/**
 * Migra imagens antigas (com paths relativos) para Cloudinary
 * Chamado automaticamente na primeira requisição após deploy
 * Ou manualmente via: POST /admin/migrate-images
 */

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const isServerless = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
const uploadRoot = isServerless ? "/tmp/uploads" : path.join(__dirname, "../../static/uploads");

export async function migrateImageToCloudinary(relPath: string, subfolder: string): Promise<string | null> {
  if (!relPath) return null;

  // Se já é uma URL completa, não precisa migrar
  if (relPath.startsWith("http://") || relPath.startsWith("https://")) {
    return relPath;
  }

  try {
    const filePath = path.join(uploadRoot, relPath);
    
    // Verificar se arquivo existe
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ Image file not found: ${filePath}`);
      return null;
    }

    // Ler arquivo e fazer upload para Cloudinary
    const fileBuffer = fs.readFileSync(filePath);
    
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `lumina/${subfolder}`,
          resource_type: "auto",
        },
        (error, result) => {
          if (error) {
            console.error("Migration error:", error);
            reject(error);
          } else if (result) {
            console.log(`✅ Migrated to Cloudinary: ${result.secure_url}`);
            // Deletar arquivo local após sucesso
            try {
              fs.unlinkSync(filePath);
              console.log(`🗑️ Deleted local: ${filePath}`);
            } catch (err) {
              console.warn(`Could not delete local file: ${err}`);
            }
            resolve(result.secure_url);
          }
        }
      );
      stream.end(fileBuffer);
    });
  } catch (err) {
    console.error(`Error migrating image ${relPath}:`, err);
    return null;
  }
}

/**
 * Migra todos os usuários com imagens antigas
 */
export async function migrateAllUserImages(): Promise<number> {
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    console.warn("⚠️ Cloudinary not configured, skipping migration");
    return 0;
  }

  const userRepo = AppDataSource.getRepository(User);
  const users = await userRepo.find();
  
  let migratedCount = 0;

  for (const user of users) {
    if (!user.imagem) continue;

    // Skip if already a full URL
    if (user.imagem.startsWith("http://") || user.imagem.startsWith("https://")) {
      continue;
    }

    const newUrl = await migrateImageToCloudinary(user.imagem, "users");
    if (newUrl) {
      user.imagem = newUrl;
      await userRepo.save(user);
      migratedCount++;
    }
  }

  console.log(`✅ Migrated ${migratedCount} user images to Cloudinary`);
  return migratedCount;
}
