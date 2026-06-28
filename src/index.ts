import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import * as path from "path";
import * as fs from "fs";
import * as bcrypt from "bcryptjs";
import { swaggerSpec } from "./config/swagger";

import { AppDataSource } from "./config/database";
import { User } from "./entities/User";
import { authRouter } from "./controllers/auth";
import { adminRouter } from "./controllers/admin";
import { editorRouter } from "./controllers/editor";
import { readerRouter } from "./controllers/reader";
import { bookClubRouter } from "./controllers/bookClub";
import { migrateAllUserImages } from "./utils/image-migration";
import { runMigrations } from "./utils/runMigrations";

export const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors());

// ─── BODY PARSERS ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── STATIC FILES ─────────────────────────────────────────────────────────────
// Em produção (Vercel), o filesystem é efêmero — usamos /tmp para uploads temporários.
// Em dev local, usamos a pasta static/uploads dentro do projeto.
const isServerless = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
const uploadRoot = isServerless
  ? "/tmp/uploads"
  : path.join(__dirname, "../static/uploads");

try {
  fs.mkdirSync(path.join(uploadRoot, "users"), { recursive: true });
  fs.mkdirSync(path.join(uploadRoot, "books"), { recursive: true });
  console.log(`✓ Upload directories ready at: ${uploadRoot}`);
} catch (err) {
  console.warn(`Warning: Could not create upload directories: ${err}`);
}

// Sempre servir uploads (em Vercel, usa /tmp; em local, usa static/uploads)
app.use("/static/uploads", express.static(uploadRoot, { fallthrough: true }));

// ─── SWAGGER ─────────────────────────────────────────────────────────────────
// Usa CDN (unpkg) para os assets do Swagger UI em vez de express.static,
// pois o filesystem serverless da Vercel não serve arquivos de node_modules.
app.get("/api-docs", (req, res) => {
  // Determina a URL base a partir do próprio request — funciona em qualquer ambiente
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  const specUrl = `${protocol}://${host}/api-docs.json`;
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Lumina API Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; }
    .swagger-ui .topbar { background-color: #1a1a2e !important; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    SwaggerUIBundle({
      url: "${specUrl}",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: "StandaloneLayout",
      persistAuthorization: true,
    });
  </script>
</body>
</html>`);
});
app.get("/api-docs.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use("/auth", authRouter);
app.use("/admin", adminRouter);
app.use("/editor", editorRouter);
app.use("/reader", readerRouter);
app.use("/reader/book-club", bookClubRouter);

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ message: "Recurso não encontrado" });
});

// ─── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Erro interno no servidor" });
});

// ─── ADMIN SEED ───────────────────────────────────────────────────────────────
async function criarAdminInicial(): Promise<void> {
  const adminEmail = process.env.ADMIN_INITIAL_EMAIL;
  const adminSenha = process.env.ADMIN_INITIAL_PASSWORD;

  if (!adminEmail || !adminSenha) {
    console.warn(
      "ADMIN_INITIAL_EMAIL e ADMIN_INITIAL_PASSWORD não definidos — admin inicial não criado."
    );
    return;
  }

  const userRepository = AppDataSource.getRepository(User);
  const exists = await userRepository.findOneBy({ email: adminEmail });

  if (!exists) {
    const salt = bcrypt.genSaltSync(10);
    const senha_hash = bcrypt.hashSync(adminSenha, salt);

    const admin = new User();
    admin.nome = "Administrador Master";
    admin.email = adminEmail;
    admin.senha_hash = senha_hash;
    admin.papel = "admin";

    await userRepository.save(admin);
    console.log("✓ Admin inicial criado com sucesso.");
  } else {
    console.log("✓ Admin inicial já existe.");
  }
}

// ─── DB INIT ──────────────────────────────────────────────────────────────────
// Em serverless, múltiplas invocações podem chegar simultaneamente antes da
// conexão estar pronta. Usamos uma promise única compartilhada para evitar o
// CannotConnectAlreadyConnectedError do TypeORM.
let dbInitPromise: Promise<void> | null = null;

export async function initializeDb(): Promise<void> {
  if (AppDataSource.isInitialized) return;
  if (!dbInitPromise) {
    dbInitPromise = AppDataSource.initialize()
      .then(() => runMigrations())
      .then(() => criarAdminInicial())
      .then(async () => {
        // Migrate old images to Cloudinary in production
        if (process.env.VERCEL === "1" && process.env.CLOUDINARY_CLOUD_NAME) {
          console.log("🔄 Starting image migration to Cloudinary...");
          await migrateAllUserImages();
        }
      })
      .catch((err) => {
        // Reseta a promise para permitir retry em caso de falha
        dbInitPromise = null;
        throw err;
      });
  }
  return dbInitPromise;
}

// ─── SERVERLESS HANDLER (Vercel) ──────────────────────────────────────────────
// Vercel usa o export default como handler HTTP.
// O wrapper garante que o banco está conectado antes de cada request.
import { Request as ExpReq, Response as ExpRes } from "express";

const handler = async (req: ExpReq, res: ExpRes) => {
  await initializeDb();
  app(req, res);
};

export default handler;

// ─── LOCAL DEV SERVER ─────────────────────────────────────────────────────────
// Em desenvolvimento local, iniciamos o servidor normalmente (não em testes).
if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
  const PORT = parseInt(process.env.PORT || "5000", 10);
  const HOST = "0.0.0.0";

  initializeDb()
    .then(() => {
      app.listen(PORT, HOST, () => {
        console.log(`✓ API rodando em http://${HOST}:${PORT}`);
        console.log(
          `  (emulador Genymotion: http://10.0.3.2:${PORT})`
        );
      });
    })
    .catch((err) => {
      console.error("✗ Falha ao conectar no banco de dados:", err);
      process.exit(1);
    });
}
