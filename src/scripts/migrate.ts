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
  process.exit(1);
});
