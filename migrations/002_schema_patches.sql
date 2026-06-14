-- Colunas ausentes no banco legado (entidades TypeORM já as definem)
ALTER TABLE livro ADD COLUMN IF NOT EXISTS condicao VARCHAR(30) DEFAULT 'novo';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS headline VARCHAR(255);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS bio TEXT;
