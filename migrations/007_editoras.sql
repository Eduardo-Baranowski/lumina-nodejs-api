CREATE TABLE IF NOT EXISTS "editora" (
  "id" SERIAL PRIMARY KEY,
  "nome" varchar(100) UNIQUE NOT NULL,
  "imagem" varchar(255),
  "criado_em" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "livro" ADD COLUMN IF NOT EXISTS "editora_id" integer REFERENCES "editora"("id") ON DELETE SET NULL;
ALTER TABLE "livro" ALTER COLUMN "editor_id" DROP NOT NULL;
