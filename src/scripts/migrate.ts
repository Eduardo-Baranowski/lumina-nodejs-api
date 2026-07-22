import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config();

import { AppDataSource } from "../config/database";
import { runMigrations } from "../utils/runMigrations";

async function main(): Promise<void> {
  await AppDataSource.initialize();
  await runMigrations();
  await AppDataSource.destroy();
  console.log("✓ Migrations concluídas.");
}

main().catch((err) => {
  console.error("✗ Erro ao executar migrations:", err);
    const isCi = process.env.CI === "true" || process.env.CI === "1";
    if (isCi || process.env.VERCEL === "1" || process.env.SKIP_DB_MIGRATIONS === "1") {
      console.warn("⚠ Ignorando falha de migrations no ambiente de build/CI.");
      process.exit(0);
    }
  process.exit(1);
});
