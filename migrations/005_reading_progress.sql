-- Colunas de progresso de leitura (entidades Livro e Leitura)
ALTER TABLE livro ADD COLUMN IF NOT EXISTS paginas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leitura ADD COLUMN IF NOT EXISTS paginas_lidas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leitura ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP NULL;
