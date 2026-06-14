import * as fs from "fs";
import * as path from "path";
import { AppDataSource } from "../config/database";

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
)`;

/**
 * Remove comentários de linha no início do statement.
 */
function normalizeStatement(sql: string): string {
  return sql
    .replace(/^(\s*--[^\n]*\n)+/m, "")
    .trim();
}

/**
 * Divide SQL em statements respeitando blocos DO $$ ... $$.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;

  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "$" && sql[i + 1] === "$") {
      inDollarQuote = !inDollarQuote;
      current += "$$";
      i++;
      continue;
    }

    if (sql[i] === ";" && !inDollarQuote) {
      const trimmed = normalizeStatement(current);
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }

    current += sql[i];
  }

  const tail = normalizeStatement(current);
  if (tail.length > 0) {
    statements.push(tail);
  }

  return statements;
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const rows: Array<{ filename: string }> = await AppDataSource.query(
    `SELECT filename FROM schema_migrations ORDER BY id`
  );
  return new Set(rows.map((r) => r.filename));
}

export async function runMigrations(): Promise<void> {
  await AppDataSource.query(MIGRATIONS_TABLE);

  // Evita corrida em deploys serverless com múltiplos cold starts simultâneos.
  await AppDataSource.query(`SELECT pg_advisory_lock(758321)`);

  try {
    const migrationsDir = path.join(__dirname, "../../migrations");
    if (!fs.existsSync(migrationsDir)) {
      console.warn("Pasta migrations/ não encontrada — nenhuma migration aplicada.");
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const applied = await getAppliedMigrations();

    for (const file of files) {
      if (applied.has(file)) continue;

      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      const statements = splitSqlStatements(sql);

      console.log(`▶ Aplicando migration: ${file} (${statements.length} statements)`);

      const queryRunner = AppDataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        for (const statement of statements) {
          await queryRunner.query(statement);
        }
        await queryRunner.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1)`,
          [file]
        );
        await queryRunner.commitTransaction();
        console.log(`✓ Migration aplicada: ${file}`);
      } catch (err) {
        await queryRunner.rollbackTransaction();
        console.error(`✗ Falha na migration ${file}:`, err);
        throw err;
      } finally {
        await queryRunner.release();
      }
    }
  } finally {
    await AppDataSource.query(`SELECT pg_advisory_unlock(758321)`);
  }
}
